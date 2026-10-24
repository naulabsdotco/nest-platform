import { createHash, randomBytes } from 'node:crypto';
import { Logger } from '@nestjs/common';
import type { PasswordVerifier } from '../crypto/password-verifier';
import { AuthResetTokenConsumedError, AuthResetTokenExpiredError, AuthResetTokenInvalidError } from '../errors';
import type { AuthStore } from '../ports/auth-store';
import type { Clock } from '../ports/clock';
import type { PasswordPolicy } from '../ports/password-policy';
import type { AuthTransaction, UnitOfWork } from '../ports/unit-of-work';

export interface ResetLinkSink {
  send(input: { email: string; token: string }): Promise<void>;
}

export interface ResetServiceOptions {
  store: AuthStore;
  clock: Clock;
  verifier: PasswordVerifier;
  policy: PasswordPolicy;
  sink: ResetLinkSink;
  resetTtlMinutes: number;
  // Without one, the three writes stay sequential and the adapter must make them atomic itself.
  unitOfWork?: UnitOfWork;
}

const RESET_BYTES = 32;

const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

export class ResetService {
  private readonly logger = new Logger(ResetService.name);

  constructor(private readonly opts: ResetServiceOptions) {}

  async forgotPassword(email: string): Promise<void> {
    const credential = await this.opts.store.findCredentialByEmail(email);
    if (credential === null) return;

    const token = randomBytes(RESET_BYTES).toString('base64url');
    const expiresAt = new Date(this.opts.clock.now().getTime() + this.opts.resetTtlMinutes * 60_000);
    await this.opts.store.issueResetToken({
      subjectId: credential.subjectId,
      tokenHash: hashToken(token),
      expiresAt,
    });

    try {
      await this.opts.sink.send({ email, token });
    } catch {
      // Returning a failure here would tell the caller the address exists; the send is the consumer's to retry.
      this.logger.warn({ event: 'auth.reset.link_failed', outcome: 'error' });
    }
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    // Before any read or write: a password the policy rejects must leave the token usable.
    await this.opts.policy.validate(newPassword);

    const record = await this.opts.store.findResetToken(hashToken(token));
    if (record === null) throw new AuthResetTokenInvalidError();
    if (record.expiresAt.getTime() <= this.opts.clock.now().getTime()) throw new AuthResetTokenExpiredError();
    if (record.consumedAt !== null) throw new AuthResetTokenConsumedError();
    const hash = await this.opts.verifier.hash(newPassword);

    const complete = async (tx?: AuthTransaction): Promise<void> => {
      // The consume also spends every other live link for the subject, so one reset retires them all.
      // The compare-and-set closes the gap between the read above and a concurrent consume.
      if (!(await this.opts.store.consumeResetToken(record.id, tx))) throw new AuthResetTokenConsumedError();
      await this.opts.store.replaceCredentialHash(record.subjectId, hash, tx);
      await this.opts.store.revokeRefreshForSubjects([record.subjectId], tx);
    };

    if (this.opts.unitOfWork === undefined) return complete();
    return this.opts.unitOfWork.transaction(complete);
  }
}
