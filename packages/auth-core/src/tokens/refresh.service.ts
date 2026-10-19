import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { AuthInvalidTokenError, AuthRefreshReuseDetectedError } from '../errors';
import type { AuthStore, RefreshRecord } from '../ports/auth-store';
import type { Clock } from '../ports/clock';

export interface RefreshServiceOptions {
  store: AuthStore;
  clock: Clock;
  reuseGraceSeconds: number;
  refreshTtlSeconds: number;
}

export interface RotatedRefresh {
  accessInput: { familyId: string; subjectId: string };
  refreshToken: string;
}

const REFRESH_BYTES = 32;
const REUSE_EVENT = 'auth.refresh.reuse_detected';

const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

export class RefreshService {
  private readonly logger = new Logger(RefreshService.name);

  constructor(private readonly opts: RefreshServiceOptions) {}

  async issue(subjectId: string): Promise<{ token: string; expiresAt: Date }> {
    return this.mint(randomUUID(), subjectId);
  }

  async rotate(presented: string): Promise<RotatedRefresh> {
    const tokenHash = hashToken(presented);
    const record = await this.opts.store.findRefreshByHash(tokenHash);
    if (record === null) throw new AuthInvalidTokenError();

    const now = this.opts.clock.now();
    if (record.revokedAt !== null) return this.rejectReuse(record);
    if (record.expiresAt.getTime() <= now.getTime()) throw new AuthInvalidTokenError();
    if (record.usedAt !== null) return this.reissue(record, now);

    const marked = await this.opts.store.markRefreshUsed(record.id);
    if (!marked) {
      // Losing the compare-and-set means a concurrent request already consumed it; the grace decides.
      const current = await this.opts.store.findRefreshByHash(tokenHash);
      if (current === null) throw new AuthInvalidTokenError();
      return this.reissue(current, now);
    }

    return this.rotateInto(record);
  }

  private async mint(familyId: string, subjectId: string): Promise<{ token: string; expiresAt: Date }> {
    const token = randomBytes(REFRESH_BYTES).toString('base64url');
    const expiresAt = new Date(this.opts.clock.now().getTime() + this.opts.refreshTtlSeconds * 1000);
    await this.opts.store.issueRefresh({ subjectId, tokenHash: hashToken(token), familyId, expiresAt });
    return { token, expiresAt };
  }

  private async reissue(record: RefreshRecord, now: Date): Promise<RotatedRefresh> {
    const usedAt = record.usedAt;
    if (usedAt !== null && now.getTime() - usedAt.getTime() <= this.opts.reuseGraceSeconds * 1000) {
      return this.rotateInto(record);
    }
    return this.rejectReuse(record);
  }

  private async rotateInto(record: Pick<RefreshRecord, 'familyId' | 'subjectId'>): Promise<RotatedRefresh> {
    // The plaintext is never stored, so even a within-grace re-issue mints a fresh token in the family.
    const { token } = await this.mint(record.familyId, record.subjectId);
    return { accessInput: { familyId: record.familyId, subjectId: record.subjectId }, refreshToken: token };
  }

  private async rejectReuse(record: RefreshRecord): Promise<never> {
    this.logger.warn({ event: REUSE_EVENT, outcome: 'denied', subjectId: record.subjectId });
    await this.opts.store.revokeRefreshFamily(record.familyId);
    throw new AuthRefreshReuseDetectedError();
  }
}
