import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  AuthInvalidCredentialsError,
  AuthScopeSelectionRequiredError,
  type AuthError,
} from '../errors';
import type { AuthScope, AuthStore, LoginAttempt, RefreshRecord, StoredCredential } from '../ports/auth-store';
import type { TokenService } from './token.service';
import type { RefreshService } from './refresh.service';
import { AuthService } from './auth.service';

const EMAIL = 'subject@example.com';
const SUBJECT = 'subject-1';
const MEMBER: AuthScope = { subject: SUBJECT, scope: 'example-app', role: 'member', active: true };
const ADMIN: AuthScope = { subject: SUBJECT, scope: 'other-app', role: 'admin', active: true };

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

class StoreFake {
  readonly attempts: LoginAttempt[] = [];
  readonly replaced: Array<{ subjectId: string; hash: string }> = [];
  readonly revokedFamilies: string[] = [];
  private credential: StoredCredential | null = null;
  private scopes: readonly AuthScope[] = [];
  private readonly refreshRows = new Map<string, RefreshRecord>();

  seedCredential(hash = 'argon2id$correct'): void {
    this.credential = { subjectId: SUBJECT, algo: 'argon2id', hash };
  }

  seedScopes(scopes: readonly AuthScope[]): void {
    this.scopes = scopes;
  }

  seedRefresh(token: string, familyId: string): void {
    this.refreshRows.set(sha256(token), {
      id: 'refresh-row-1',
      familyId,
      subjectId: SUBJECT,
      expiresAt: new Date('2026-11-01T00:00:00.000Z'),
      usedAt: null,
      revokedAt: null,
    });
  }

  async findCredentialByEmail(): Promise<StoredCredential | null> {
    return this.credential;
  }

  async findScopesByEmail(): Promise<readonly AuthScope[]> {
    return this.scopes;
  }

  async replaceCredentialHash(subjectId: string, hash: string): Promise<void> {
    this.replaced.push({ subjectId, hash });
  }

  async recordLoginAttempt(attempt: LoginAttempt): Promise<void> {
    this.attempts.push(attempt);
  }

  async findRefreshByHash(tokenHash: string): Promise<RefreshRecord | null> {
    return this.refreshRows.get(tokenHash) ?? null;
  }

  async revokeRefreshFamily(familyId: string): Promise<void> {
    this.revokedFamilies.push(familyId);
  }

  asStore(): AuthStore {
    return this as unknown as AuthStore;
  }
}

class VerifierFake {
  dummyChecks = 0;

  constructor(
    private readonly password: string,
    private readonly rehash?: string,
  ) {}

  async verify(_credential: StoredCredential, presented: string): Promise<{ ok: boolean; rehash?: string }> {
    if (presented !== this.password) return { ok: false };
    return this.rehash === undefined ? { ok: true } : { ok: true, rehash: this.rehash };
  }

  async verifyDummy(): Promise<void> {
    this.dummyChecks += 1;
  }

  async hash(password: string): Promise<string> {
    return `argon2id$${password}`;
  }
}

class RefreshFake {
  readonly issued: string[] = [];

  async issue(subjectId: string): Promise<{ token: string; expiresAt: Date }> {
    this.issued.push(subjectId);
    return { token: `refresh:${subjectId}`, expiresAt: new Date('2026-11-01T00:00:00.000Z') };
  }

  async rotate(): Promise<{ accessInput: { familyId: string; subjectId: string }; refreshToken: string }> {
    return { accessInput: { familyId: 'family-1', subjectId: SUBJECT }, refreshToken: 'rotated-refresh-token' };
  }
}

const tokens = {
  issueAccess: (sub: string) => ({ accessToken: `access:${sub}`, expiresIn: 900 }),
} as unknown as TokenService;

const serviceOver = (store: StoreFake, verifier: VerifierFake, refresh = new RefreshFake()): AuthService =>
  new AuthService({
    store: store.asStore(),
    verifier: verifier as never,
    tokens,
    refresh: refresh as unknown as RefreshService,
  });

const errorOf = async (run: () => Promise<unknown>): Promise<AuthError> => {
  try {
    await run();
  } catch (error) {
    return error as AuthError;
  }
  throw new Error('the call was expected to reject');
};

describe('AuthService.login', () => {
  it('a valid credential returns an access token, a refresh token and the resolved scope', async () => {
    const store = new StoreFake();
    store.seedCredential();
    store.seedScopes([MEMBER]);

    const result = await serviceOver(store, new VerifierFake('correct')).login({
      email: EMAIL,
      password: 'correct',
      ip: '203.0.113.7',
    });

    expect(result).toEqual({
      accessToken: `access:${SUBJECT}`,
      expiresIn: 900,
      refreshToken: `refresh:${SUBJECT}`,
      scope: MEMBER,
    });
  });

  it('an unknown email runs a dummy verify and returns the identical 401', async () => {
    const store = new StoreFake();
    const verifier = new VerifierFake('correct');

    const unknown = await errorOf(() => serviceOver(store, verifier).login({ email: EMAIL, password: 'correct' }));

    store.seedCredential();
    store.seedScopes([MEMBER]);
    const wrong = await errorOf(() => serviceOver(store, verifier).login({ email: EMAIL, password: 'wrong' }));

    expect(unknown).toBeInstanceOf(AuthInvalidCredentialsError);
    expect(verifier.dummyChecks).toBe(1);
    expect(wrong.constructor).toBe(unknown.constructor);
    expect(wrong.code).toBe(unknown.code);
  });

  it('a wrong password is refused', async () => {
    const store = new StoreFake();
    store.seedCredential();
    store.seedScopes([MEMBER]);

    await expect(
      serviceOver(store, new VerifierFake('correct')).login({ email: EMAIL, password: 'wrong' }),
    ).rejects.toBeInstanceOf(AuthInvalidCredentialsError);
  });

  it('a scope-less subject is refused', async () => {
    const store = new StoreFake();
    store.seedCredential();
    store.seedScopes([]);

    await expect(
      serviceOver(store, new VerifierFake('correct')).login({ email: EMAIL, password: 'correct' }),
    ).rejects.toBeInstanceOf(AuthInvalidCredentialsError);
  });

  it('a multi-scope subject with no selection throws AuthScopeSelectionRequiredError', async () => {
    const store = new StoreFake();
    store.seedCredential();
    store.seedScopes([MEMBER, ADMIN]);

    await expect(
      serviceOver(store, new VerifierFake('correct')).login({ email: EMAIL, password: 'correct' }),
    ).rejects.toBeInstanceOf(AuthScopeSelectionRequiredError);
  });

  it('a multi-scope subject with a valid selection logs in', async () => {
    const store = new StoreFake();
    store.seedCredential();
    store.seedScopes([MEMBER, ADMIN]);

    const result = await serviceOver(store, new VerifierFake('correct')).login({
      email: EMAIL,
      password: 'correct',
      scope: ADMIN.scope,
    });

    expect(result.scope).toEqual(ADMIN);
  });

  it('a selection the subject does not hold is refused', async () => {
    const store = new StoreFake();
    store.seedCredential();
    store.seedScopes([MEMBER, ADMIN]);

    await expect(
      serviceOver(store, new VerifierFake('correct')).login({
        email: EMAIL,
        password: 'correct',
        scope: 'another-app',
      }),
    ).rejects.toBeInstanceOf(AuthInvalidCredentialsError);
  });

  it('a verifier rehash upgrades the stored credential', async () => {
    const store = new StoreFake();
    store.seedCredential('bcrypt$old');
    store.seedScopes([MEMBER]);

    await serviceOver(store, new VerifierFake('correct', 'argon2id$upgraded')).login({
      email: EMAIL,
      password: 'correct',
    });

    expect(store.replaced).toEqual([{ subjectId: SUBJECT, hash: 'argon2id$upgraded' }]);
  });

  it('records every attempt with a hashed email and never the password or the plaintext email', async () => {
    const store = new StoreFake();
    store.seedCredential();
    store.seedScopes([MEMBER]);
    const service = serviceOver(store, new VerifierFake('correct'));

    await service.login({ email: EMAIL, password: 'correct', ip: '203.0.113.7' });
    await errorOf(() => service.login({ email: EMAIL, password: 'wrong' }));

    expect(store.attempts).toHaveLength(2);
    for (const attempt of store.attempts) {
      expect(attempt.emailHash).toBe(sha256(EMAIL));
      expect(attempt.emailHash).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(store.attempts.map((attempt) => attempt.outcome)).toEqual(['success', 'denied']);
    expect(JSON.stringify(store.attempts)).not.toContain('correct');
    expect(JSON.stringify(store.attempts)).not.toContain(EMAIL);
  });
});

describe('AuthService.refresh', () => {
  it('rotates the refresh and issues a new access token for its subject', async () => {
    const store = new StoreFake();

    const result = await serviceOver(store, new VerifierFake('correct')).refresh('presented-refresh');

    expect(result).toEqual({
      accessToken: `access:${SUBJECT}`,
      expiresIn: 900,
      refreshToken: 'rotated-refresh-token',
    });
  });
});

describe('AuthService.logout', () => {
  it("revokes the presented refresh token's family", async () => {
    const store = new StoreFake();
    store.seedRefresh('presented-refresh', 'family-9');

    await serviceOver(store, new VerifierFake('correct')).logout('presented-refresh');

    expect(store.revokedFamilies).toEqual(['family-9']);
  });

  it('an unknown refresh is ignored', async () => {
    const store = new StoreFake();

    await expect(
      serviceOver(store, new VerifierFake('correct')).logout('unknown-refresh'),
    ).resolves.toBeUndefined();
    expect(store.revokedFamilies).toEqual([]);
  });
});
