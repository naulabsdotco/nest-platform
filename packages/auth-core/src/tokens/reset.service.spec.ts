import { createHash } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AuthPasswordPolicyError,
  AuthResetTokenConsumedError,
  AuthResetTokenExpiredError,
  AuthResetTokenInvalidError,
} from '../errors';
import type { AuthStore, ResetInput, ResetRecord, StoredCredential } from '../ports/auth-store';
import type { Clock } from '../ports/clock';
import type { PasswordPolicy } from '../ports/password-policy';
import type { AuthTransaction, UnitOfWork } from '../ports/unit-of-work';
import type { PasswordVerifier } from '../crypto/password-verifier';
import { ResetService, type ResetLinkSink } from './reset.service';

class MutableClock implements Clock {
  constructor(private current: Date) {}

  now(): Date {
    return this.current;
  }

  advance(minutes: number): void {
    this.current = new Date(this.current.getTime() + minutes * 60_000);
  }
}

class ResetStore {
  readonly issued: ResetInput[] = [];
  readonly replaced: Array<{ subjectId: string; hash: string }> = [];
  readonly revokedSubjects: string[][] = [];
  readonly calls: Array<{ method: string; tx?: AuthTransaction }> = [];
  activeTx: AuthTransaction;
  failReplace = false;
  private readonly resets = new Map<string, ResetRecord>();
  private readonly credentials = new Map<string, StoredCredential>();
  private seq = 0;

  readonly unitOfWork: UnitOfWork = {
    transaction: async (work) => {
      const resets = new Map(this.resets);
      const credentials = new Map(this.credentials);
      const replaced = [...this.replaced];
      const revoked = [...this.revokedSubjects];
      this.activeTx = { client: 'tx' };
      try {
        return await work(this.activeTx);
      } catch (error) {
        this.resets.clear();
        for (const [hash, record] of resets) this.resets.set(hash, record);
        this.credentials.clear();
        for (const [email, credential] of credentials) this.credentials.set(email, credential);
        this.replaced.splice(0, this.replaced.length, ...replaced);
        this.revokedSubjects.splice(0, this.revokedSubjects.length, ...revoked);
        throw error;
      }
    },
  };

  constructor(private readonly clock: Clock) {}

  seed(email: string, subjectId: string): void {
    this.credentials.set(email, { subjectId, algo: 'argon2id', hash: 'argon2id$old' });
  }

  async findCredentialByEmail(email: string): Promise<StoredCredential | null> {
    return this.credentials.get(email) ?? null;
  }

  async issueResetToken(input: ResetInput): Promise<ResetRecord> {
    this.issued.push(input);
    const record: ResetRecord = {
      id: `reset-${++this.seq}`,
      subjectId: input.subjectId,
      expiresAt: input.expiresAt,
      consumedAt: null,
    };
    this.resets.set(input.tokenHash, record);
    return record;
  }

  async findResetToken(tokenHash: string, tx?: AuthTransaction): Promise<ResetRecord | null> {
    this.calls.push({ method: 'findResetToken', tx });
    return this.resets.get(tokenHash) ?? null;
  }

  // Consumes every live row for the subject, not only the presented one.
  async consumeResetToken(id: string, tx?: AuthTransaction): Promise<boolean> {
    this.calls.push({ method: 'consumeResetToken', tx });
    const target = [...this.resets.values()].find((record) => record.id === id);
    if (target === undefined || target.consumedAt !== null) return false;
    for (const [hash, record] of this.resets) {
      if (record.subjectId === target.subjectId) this.resets.set(hash, { ...record, consumedAt: this.clock.now() });
    }
    return true;
  }

  async replaceCredentialHash(subjectId: string, hash: string, tx?: AuthTransaction): Promise<void> {
    this.calls.push({ method: 'replaceCredentialHash', tx });
    if (this.failReplace) throw new Error('replace failed');
    this.replaced.push({ subjectId, hash });
    for (const [email, credential] of this.credentials) {
      if (credential.subjectId === subjectId) this.credentials.set(email, { ...credential, hash });
    }
  }

  async revokeRefreshForSubjects(subjectIds: readonly string[], tx?: AuthTransaction): Promise<void> {
    this.calls.push({ method: 'revokeRefreshForSubjects', tx });
    this.revokedSubjects.push([...subjectIds]);
  }

  credentialHash(email: string): string | undefined {
    return this.credentials.get(email)?.hash;
  }

  asStore(): AuthStore {
    return this as unknown as AuthStore;
  }
}

class RecordingSink implements ResetLinkSink {
  readonly sent: Array<{ email: string; token: string }> = [];

  async send(input: { email: string; token: string }): Promise<void> {
    this.sent.push(input);
  }
}

class FailingSink implements ResetLinkSink {
  async send(): Promise<never> {
    throw new Error('smtp is down');
  }
}

const MIN_LENGTH = 12;

const policy: PasswordPolicy = {
  validate(password: string): void {
    if (password.length < MIN_LENGTH) throw new AuthPasswordPolicyError({ reason: 'too short' });
  },
};

const verifier = { hash: async (password: string): Promise<string> => `argon2id$${password}` } as unknown as PasswordVerifier;

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

const clock = (): MutableClock => new MutableClock(new Date('2026-10-19T00:00:00.000Z'));

const serviceOver = (
  store: ResetStore,
  time: MutableClock,
  sink: ResetLinkSink,
  unitOfWork?: UnitOfWork,
): ResetService =>
  new ResetService({
    store: store.asStore(),
    clock: time,
    verifier,
    policy,
    sink,
    resetTtlMinutes: 20,
    ...(unitOfWork === undefined ? {} : { unitOfWork }),
  });

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ResetService.forgotPassword', () => {
  it('mints a token for a known subject and hands it to the sink without storing the plaintext', async () => {
    const time = clock();
    const store = new ResetStore(time);
    store.seed('subject@example.com', 'subject-1');
    const sink = new RecordingSink();

    await serviceOver(store, time, sink).forgotPassword('subject@example.com');

    expect(sink.sent).toHaveLength(1);
    expect(sink.sent[0].email).toBe('subject@example.com');
    const { token } = sink.sent[0];
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    expect(token).not.toContain('.');
    expect(store.issued[0].subjectId).toBe('subject-1');
    expect(store.issued[0].tokenHash).toBe(sha256(token));
    expect(store.issued[0].tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(store.issued[0].expiresAt.getTime()).toBe(time.now().getTime() + 20 * 60_000);
    expect(JSON.stringify(store.issued)).not.toContain(token);
  });

  it('returns the identical result for a known and an unknown address', async () => {
    const time = clock();
    const store = new ResetStore(time);
    store.seed('known@example.com', 'subject-1');
    const sink = new RecordingSink();
    const service = serviceOver(store, time, sink);

    const known = await service.forgotPassword('known@example.com');
    const unknown = await service.forgotPassword('unknown@example.com');

    expect(known).toBeUndefined();
    expect(unknown).toBeUndefined();
    expect(store.issued).toHaveLength(1);
    expect(sink.sent.map((entry) => entry.email)).toEqual(['known@example.com']);
  });

  it('logs and swallows a failing sink without revealing it', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const time = clock();
    const store = new ResetStore(time);
    store.seed('known@example.com', 'subject-1');

    await expect(serviceOver(store, time, new FailingSink()).forgotPassword('known@example.com')).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({ event: 'auth.reset.link_failed', outcome: 'error' }));
  });
});

describe('ResetService.resetPassword', () => {
  const knownToken = async (store: ResetStore, sink: RecordingSink, time: MutableClock): Promise<string> => {
    store.seed('subject@example.com', 'subject-1');
    await serviceOver(store, time, sink).forgotPassword('subject@example.com');
    return sink.sent[0].token;
  };

  it('consumes the token, stores an argon2id hash and revokes every refresh family', async () => {
    const time = clock();
    const store = new ResetStore(time);
    const sink = new RecordingSink();
    const service = serviceOver(store, time, sink);
    const token = await knownToken(store, sink, time);

    await service.resetPassword(token, 'a-good-password');

    expect(store.replaced).toEqual([{ subjectId: 'subject-1', hash: 'argon2id$a-good-password' }]);
    expect(store.credentialHash('subject@example.com')).toBe('argon2id$a-good-password');
    expect(store.revokedSubjects).toEqual([['subject-1']]);
  });

  it('threads the transaction handle into all three writes', async () => {
    const time = clock();
    const store = new ResetStore(time);
    const sink = new RecordingSink();
    const service = serviceOver(store, time, sink, store.unitOfWork);
    const token = await knownToken(store, sink, time);

    await service.resetPassword(token, 'a-good-password');

    const writes = store.calls.filter(({ method }) => method !== 'findResetToken');
    expect(writes.map(({ method }) => method)).toEqual([
      'consumeResetToken',
      'replaceCredentialHash',
      'revokeRefreshForSubjects',
    ]);
    for (const { tx } of writes) expect(tx).toBe(store.activeTx);
  });

  it('refuses an unknown token', async () => {
    const time = clock();
    const store = new ResetStore(time);

    await expect(
      serviceOver(store, time, new RecordingSink()).resetPassword('not-a-token', 'a-good-password'),
    ).rejects.toBeInstanceOf(AuthResetTokenInvalidError);
  });

  it('refuses a token consumed twice', async () => {
    const time = clock();
    const store = new ResetStore(time);
    const sink = new RecordingSink();
    const service = serviceOver(store, time, sink);
    const token = await knownToken(store, sink, time);
    await service.resetPassword(token, 'a-good-password');

    await expect(service.resetPassword(token, 'another-good-password')).rejects.toBeInstanceOf(
      AuthResetTokenConsumedError,
    );
  });

  it('refuses an expired token', async () => {
    const time = clock();
    const store = new ResetStore(time);
    const sink = new RecordingSink();
    const service = serviceOver(store, time, sink);
    const token = await knownToken(store, sink, time);
    time.advance(21);

    await expect(service.resetPassword(token, 'a-good-password')).rejects.toBeInstanceOf(
      AuthResetTokenExpiredError,
    );
  });

  it('enforces the policy before any state change, leaving a rejected token usable', async () => {
    const time = clock();
    const store = new ResetStore(time);
    const sink = new RecordingSink();
    const service = serviceOver(store, time, sink);
    const token = await knownToken(store, sink, time);

    await expect(service.resetPassword(token, 'short')).rejects.toBeInstanceOf(AuthPasswordPolicyError);
    expect(store.replaced).toEqual([]);
    expect(store.revokedSubjects).toEqual([]);

    await expect(service.resetPassword(token, 'a-good-password')).resolves.toBeUndefined();
    expect(store.replaced).toEqual([{ subjectId: 'subject-1', hash: 'argon2id$a-good-password' }]);
  });

  it('an injected failure after the consume rolls the token and the hash back together', async () => {
    const time = clock();
    const store = new ResetStore(time);
    const sink = new RecordingSink();
    const service = serviceOver(store, time, sink, store.unitOfWork);
    const token = await knownToken(store, sink, time);
    store.failReplace = true;

    await expect(service.resetPassword(token, 'a-good-password')).rejects.toThrow('replace failed');

    expect((await store.findResetToken(sha256(token)))?.consumedAt).toBeNull();
    expect(store.credentialHash('subject@example.com')).toBe('argon2id$old');
    const attempted = store.calls.filter(({ method }) => method !== 'findResetToken');
    expect(attempted.length).toBeGreaterThan(0);
    for (const { tx } of attempted) expect(tx).toBe(store.activeTx);

    store.failReplace = false;
    await expect(service.resetPassword(token, 'a-good-password')).resolves.toBeUndefined();
    expect(store.credentialHash('subject@example.com')).toBe('argon2id$a-good-password');
  });

  it('a successful reset consumes every live link for the subject', async () => {
    const time = clock();
    const store = new ResetStore(time);
    const sink = new RecordingSink();
    const service = serviceOver(store, time, sink, store.unitOfWork);
    const first = await knownToken(store, sink, time);
    await service.forgotPassword('subject@example.com');
    const second = sink.sent[1].token;
    expect(second).not.toBe(first);

    await service.resetPassword(first, 'a-good-password');

    expect((await store.findResetToken(sha256(second)))?.consumedAt).not.toBeNull();
    await expect(service.resetPassword(second, 'another-good-password')).rejects.toBeInstanceOf(
      AuthResetTokenConsumedError,
    );
  });
});
