import { createHash } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthInvalidTokenError, AuthRefreshReuseDetectedError } from '../errors';
import type { AuthStore, RefreshInput, RefreshRecord } from '../ports/auth-store';
import type { Clock } from '../ports/clock';
import { RefreshService } from './refresh.service';

class MutableClock implements Clock {
  constructor(private current: Date) {}

  now(): Date {
    return this.current;
  }

  advance(seconds: number): void {
    this.current = new Date(this.current.getTime() + seconds * 1000);
  }
}

class RefreshStore {
  readonly savedInputs: RefreshInput[] = [];
  readonly revokedFamilies: string[] = [];
  readonly usedIds: string[] = [];
  onMarked?: (familyId: string) => void;
  private readonly rows = new Map<string, RefreshRecord>();
  private seq = 0;

  constructor(private readonly clock: Clock) {}

  async issueRefresh(input: RefreshInput): Promise<RefreshRecord> {
    this.savedInputs.push(input);
    const record: RefreshRecord = {
      id: `row-${++this.seq}`,
      familyId: input.familyId,
      subjectId: input.subjectId,
      expiresAt: input.expiresAt,
      usedAt: null,
      revokedAt: null,
      scope: input.scope ?? null,
    };
    this.rows.set(input.tokenHash, record);
    return record;
  }

  async findRefreshByHash(tokenHash: string): Promise<RefreshRecord | null> {
    return this.rows.get(tokenHash) ?? null;
  }

  async markRefreshUsed(id: string): Promise<boolean> {
    for (const [hash, row] of this.rows) {
      if (row.id !== id) continue;
      if (row.usedAt !== null) return false;
      this.rows.set(hash, { ...row, usedAt: this.clock.now() });
      this.usedIds.push(id);
      this.onMarked?.(row.familyId);
      return true;
    }
    return false;
  }

  async revokeRefreshFamily(familyId: string): Promise<void> {
    this.revokedFamilies.push(familyId);
    this.revokeDirect(familyId);
  }

  // Simulates a concurrent logout that this service did not perform, so it is not in `revokedFamilies`.
  revokeDirect(familyId: string): void {
    for (const [hash, row] of this.rows) {
      if (row.familyId === familyId) this.rows.set(hash, { ...row, revokedAt: this.clock.now() });
    }
  }

  liveCount(): number {
    return [...this.rows.values()].filter((row) => row.revokedAt === null).length;
  }

  asStore(): AuthStore {
    return this as unknown as AuthStore;
  }
}

const clock = (): MutableClock => new MutableClock(new Date('2026-10-19T00:00:00.000Z'));

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

const serviceOver = (store: RefreshStore, time: MutableClock): RefreshService =>
  new RefreshService({ store: store.asStore(), clock: time, reuseGraceSeconds: 10, refreshTtlSeconds: 3600 });

afterEach(() => {
  vi.restoreAllMocks();
});

describe('RefreshService.issue', () => {
  it('mints 32 random bytes and stores only their SHA-256 hex', async () => {
    const time = clock();
    const store = new RefreshStore(time);

    const { token, expiresAt } = await serviceOver(store, time).issue('subject-1');

    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    expect(expiresAt.getTime()).toBe(time.now().getTime() + 3600 * 1000);
    expect(store.savedInputs).toHaveLength(1);
    expect(store.savedInputs[0].tokenHash).toBe(sha256(token));
    expect(store.savedInputs[0].tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(store.savedInputs[0].subjectId).toBe('subject-1');
    expect(JSON.stringify(store.savedInputs)).not.toContain(token);
  });

  it('carries scope, user agent and ip into the refresh row', async () => {
    const time = clock();
    const store = new RefreshStore(time);

    await serviceOver(store, time).issue({
      subjectId: 'subject-1',
      scope: 'example-app',
      userAgent: 'agent/1',
      ip: '203.0.113.7',
    });

    expect(store.savedInputs[0]).toMatchObject({
      subjectId: 'subject-1',
      scope: 'example-app',
      userAgent: 'agent/1',
      ip: '203.0.113.7',
    });
  });

  it('leaves missing metadata unset so the adapter stores nulls', async () => {
    const time = clock();
    const store = new RefreshStore(time);

    await serviceOver(store, time).issue({ subjectId: 'subject-1' });

    expect(store.savedInputs[0].scope).toBeUndefined();
    expect(store.savedInputs[0].userAgent).toBeUndefined();
    expect(store.savedInputs[0].ip).toBeUndefined();
  });

  it('reuses a supplied familyId and mints a fresh one when it is omitted', async () => {
    const time = clock();
    const store = new RefreshStore(time);
    const service = serviceOver(store, time);

    await service.issue({ subjectId: 'subject-1', familyId: 'family-1' });
    await service.issue({ subjectId: 'subject-1' });

    expect(store.savedInputs[0].familyId).toBe('family-1');
    expect(store.savedInputs[1].familyId).not.toBe('family-1');
  });

  it('mints a distinct token and family per call', async () => {
    const time = clock();
    const store = new RefreshStore(time);
    const service = serviceOver(store, time);

    const first = await service.issue('subject-1');
    const second = await service.issue('subject-1');

    expect(first.token).not.toBe(second.token);
    expect(store.savedInputs[0].familyId).not.toBe(store.savedInputs[1].familyId);
  });
});

describe('RefreshService.rotate', () => {
  it('a valid refresh rotates into a new token in the same family and marks the old one used', async () => {
    const time = clock();
    const store = new RefreshStore(time);
    const service = serviceOver(store, time);
    const { token } = await service.issue('subject-1');
    const { familyId } = store.savedInputs[0];

    const rotated = await service.rotate(token);

    expect(rotated.accessInput).toEqual({ familyId, subjectId: 'subject-1' });
    expect(rotated.refreshToken).not.toBe(token);
    expect(store.usedIds).toEqual(['row-1']);
    expect(store.savedInputs.map((input) => input.familyId)).toEqual([familyId, familyId]);
    expect(store.revokedFamilies).toEqual([]);
  });

  it('rotation reuses the family and its scope without a new selection', async () => {
    const time = clock();
    const store = new RefreshStore(time);
    const service = serviceOver(store, time);
    const { token } = await service.issue({ subjectId: 'subject-1', scope: 'example-app' });
    const { familyId } = store.savedInputs[0];

    const rotated = await service.rotate(token);

    expect(rotated.accessInput).toEqual({ familyId, subjectId: 'subject-1' });
    expect(store.savedInputs[1]).toMatchObject({ familyId, subjectId: 'subject-1', scope: 'example-app' });
  });

  it('a consumed refresh outside the grace revokes the whole family and throws', async () => {
    const time = clock();
    const store = new RefreshStore(time);
    const service = serviceOver(store, time);
    const { token } = await service.issue('subject-1');
    const { familyId } = store.savedInputs[0];
    await service.rotate(token);
    time.advance(11);

    await expect(service.rotate(token)).rejects.toBeInstanceOf(AuthRefreshReuseDetectedError);
    expect(store.revokedFamilies).toEqual([familyId]);
  });

  it('a consumed refresh inside the grace re-issues and does not revoke', async () => {
    const time = clock();
    const store = new RefreshStore(time);
    const service = serviceOver(store, time);
    const { token } = await service.issue('subject-1');
    const { familyId } = store.savedInputs[0];
    await service.rotate(token);
    time.advance(5);

    const reissued = await service.rotate(token);

    expect(reissued.accessInput).toEqual({ familyId, subjectId: 'subject-1' });
    expect(reissued.refreshToken).not.toBe(token);
    expect(store.revokedFamilies).toEqual([]);
  });

  it('a revoked refresh is refused and revokes the family again', async () => {
    const time = clock();
    const store = new RefreshStore(time);
    const service = serviceOver(store, time);
    const { token } = await service.issue('subject-1');
    const { familyId } = store.savedInputs[0];
    await store.revokeRefreshFamily(familyId);

    await expect(service.rotate(token)).rejects.toBeInstanceOf(AuthRefreshReuseDetectedError);
    expect(store.revokedFamilies).toEqual([familyId, familyId]);
  });

  it('an expired refresh is refused', async () => {
    const time = clock();
    const store = new RefreshStore(time);
    const service = serviceOver(store, time);
    const { token } = await service.issue('subject-1');
    time.advance(3601);

    await expect(service.rotate(token)).rejects.toBeInstanceOf(AuthInvalidTokenError);
    expect(store.revokedFamilies).toEqual([]);
  });

  it('an unknown refresh is refused', async () => {
    const time = clock();
    const store = new RefreshStore(time);

    await expect(serviceOver(store, time).rotate('not-a-refresh-token')).rejects.toBeInstanceOf(
      AuthInvalidTokenError,
    );
  });

  it('a lost markRefreshUsed race re-issues inside the grace instead of revoking', async () => {
    const time = clock();
    const base: RefreshRecord = {
      id: 'row-1',
      familyId: 'family-1',
      subjectId: 'subject-1',
      expiresAt: new Date(time.now().getTime() + 3600 * 1000),
      usedAt: null,
      revokedAt: null,
    };
    const revoked: string[] = [];
    let reads = 0;
    const store = {
      issueRefresh: async (input: RefreshInput): Promise<RefreshRecord> => ({ ...base, familyId: input.familyId }),
      findRefreshByHash: async (): Promise<RefreshRecord | null> =>
        reads++ === 0 ? base : { ...base, usedAt: time.now() },
      markRefreshUsed: async (): Promise<boolean> => false,
      revokeRefreshFamily: async (familyId: string): Promise<void> => {
        revoked.push(familyId);
      },
    } as unknown as AuthStore;
    const service = new RefreshService({ store, clock: time, reuseGraceSeconds: 10, refreshTtlSeconds: 3600 });

    const result = await service.rotate('token-presented-twice');

    expect(result.accessInput).toEqual({ familyId: 'family-1', subjectId: 'subject-1' });
    expect(revoked).toEqual([]);
  });

  it('a lost CAS whose re-read is revoked revokes the family and throws', async () => {
    const time = clock();
    const base: RefreshRecord = {
      id: 'row-1',
      familyId: 'family-1',
      subjectId: 'subject-1',
      expiresAt: new Date(time.now().getTime() + 3600 * 1000),
      usedAt: null,
      revokedAt: null,
    };
    const revoked: string[] = [];
    let reads = 0;
    const store = {
      issueRefresh: async (input: RefreshInput): Promise<RefreshRecord> => ({ ...base, familyId: input.familyId }),
      findRefreshByHash: async (): Promise<RefreshRecord | null> =>
        reads++ === 0 ? base : { ...base, usedAt: time.now(), revokedAt: time.now() },
      markRefreshUsed: async (): Promise<boolean> => false,
      revokeRefreshFamily: async (familyId: string): Promise<void> => {
        revoked.push(familyId);
      },
    } as unknown as AuthStore;
    const service = new RefreshService({ store, clock: time, reuseGraceSeconds: 10, refreshTtlSeconds: 3600 });

    await expect(service.rotate('token-presented-twice')).rejects.toBeInstanceOf(AuthRefreshReuseDetectedError);
    expect(revoked).toEqual(['family-1']);
  });

  it('a rotate that races a logout revokes the newly minted row and throws', async () => {
    const time = clock();
    const store = new RefreshStore(time);
    const service = serviceOver(store, time);
    const { token } = await service.issue('subject-1');
    const { familyId } = store.savedInputs[0];
    // The logout lands between rotate's read and its compare-and-set.
    store.onMarked = () => store.revokeDirect(familyId);

    await expect(service.rotate(token)).rejects.toBeInstanceOf(AuthRefreshReuseDetectedError);
    expect(store.revokedFamilies).toEqual([familyId]);
    expect(store.liveCount()).toBe(0);
  });

  it('a consumed token replayed after expiry still revokes the family', async () => {
    const time = clock();
    const store = new RefreshStore(time);
    const service = serviceOver(store, time);
    const { token } = await service.issue('subject-1');
    const { familyId } = store.savedInputs[0];
    await service.rotate(token);
    time.advance(3601);

    await expect(service.rotate(token)).rejects.toBeInstanceOf(AuthRefreshReuseDetectedError);
    expect(store.revokedFamilies).toEqual([familyId]);
  });

  it('reuse detection emits auth.refresh.reuse_detected and never the token', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const time = clock();
    const store = new RefreshStore(time);
    const service = serviceOver(store, time);
    const { token } = await service.issue('subject-1');
    await service.rotate(token);
    time.advance(11);

    await expect(service.rotate(token)).rejects.toBeInstanceOf(AuthRefreshReuseDetectedError);

    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'auth.refresh.reuse_detected', outcome: 'denied' }),
    );
    expect(JSON.stringify(warn.mock.calls)).not.toContain(token);
  });

  it('a valid rotation emits nothing', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const time = clock();
    const store = new RefreshStore(time);
    const service = serviceOver(store, time);
    const { token } = await service.issue('subject-1');

    await service.rotate(token);

    expect(warn).not.toHaveBeenCalled();
  });
});
