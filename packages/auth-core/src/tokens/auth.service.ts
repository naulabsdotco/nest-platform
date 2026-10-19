import { createHash } from 'node:crypto';
import type { PasswordVerifier } from '../crypto/password-verifier';
import { AuthInvalidCredentialsError, AuthScopeSelectionRequiredError, type AuthError } from '../errors';
import type { AuthScope, AuthStore } from '../ports/auth-store';
import type { RefreshService } from './refresh.service';
import type { TokenService } from './token.service';

export interface AuthServiceOptions {
  store: AuthStore;
  verifier: PasswordVerifier;
  tokens: TokenService;
  refresh: RefreshService;
}

export interface LoginInput {
  email: string;
  password: string;
  scope?: string;
  ip?: string;
}

export interface LoginResult {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  scope: AuthScope;
}

const sha256Hex = (value: string): string => createHash('sha256').update(value).digest('hex');

export class AuthService {
  constructor(private readonly opts: AuthServiceOptions) {}

  async login(input: LoginInput): Promise<LoginResult> {
    const credential = await this.opts.store.findCredentialByEmail(input.email);
    if (credential === null) {
      // The dummy verify keeps an unknown address from answering faster than a wrong password.
      await this.opts.verifier.verifyDummy(input.password);
      return this.deny(input, 'unknown-subject', new AuthInvalidCredentialsError());
    }

    const { ok, rehash } = await this.opts.verifier.verify(credential, input.password);
    if (!ok) return this.deny(input, 'bad-password', new AuthInvalidCredentialsError());
    if (rehash !== undefined) await this.opts.store.replaceCredentialHash(credential.subjectId, rehash);

    const scopes = await this.opts.store.findScopesByEmail(input.email);
    if (scopes.length === 0) return this.deny(input, 'no-scope', new AuthInvalidCredentialsError());

    let scope: AuthScope;
    // A single scope needs no selection; several do, and the selected one must be held, never guessed.
    if (scopes.length === 1) {
      scope = scopes[0];
    } else if (input.scope === undefined) {
      return this.deny(input, 'selection-required', new AuthScopeSelectionRequiredError());
    } else {
      const selected = scopes.find((candidate) => candidate.scope === input.scope);
      if (selected === undefined) return this.deny(input, 'selection-invalid', new AuthInvalidCredentialsError());
      scope = selected;
    }

    const { accessToken, expiresIn } = this.opts.tokens.issueAccess(credential.subjectId);
    const { token: refreshToken } = await this.opts.refresh.issue(credential.subjectId);
    await this.record(input, 'success');
    return { accessToken, expiresIn, refreshToken, scope };
  }

  async refresh(presented: string): Promise<{ accessToken: string; expiresIn: number; refreshToken: string }> {
    const { accessInput, refreshToken } = await this.opts.refresh.rotate(presented);
    const { accessToken, expiresIn } = this.opts.tokens.issueAccess(accessInput.subjectId);
    return { accessToken, expiresIn, refreshToken };
  }

  async logout(presented: string): Promise<void> {
    const record = await this.opts.store.findRefreshByHash(sha256Hex(presented));
    if (record !== null) await this.opts.store.revokeRefreshFamily(record.familyId);
  }

  // A single scope needs no selection; several do, and the selected one must be held, never guessed.
  private async deny(input: LoginInput, reason: string, error: AuthError): Promise<never> {
    await this.record(input, 'denied', reason);
    throw error;
  }

  private async record(input: LoginInput, outcome: string, reason?: string): Promise<void> {
    await this.opts.store.recordLoginAttempt({
      emailHash: sha256Hex(input.email),
      ip: input.ip ?? '0.0.0.0',
      outcome,
      ...(reason === undefined ? {} : { reason }),
    });
  }
}
