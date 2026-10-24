import { ApplicationError, DomainError } from '@naulabsco/errors';
import { describe, expect, it } from 'vitest';
import {
  AUTH_ERROR_CODES,
  AUTH_ERROR_STATUS,
  AuthConfigError,
  AuthInvalidCredentialsError,
  AuthInvalidTokenError,
  AuthPasswordPolicyError,
  AuthRefreshReuseDetectedError,
  AuthResetTokenConsumedError,
  AuthResetTokenExpiredError,
  AuthResetTokenInvalidError,
  AuthRoleForbiddenError,
  AuthScopeSelectionRequiredError,
  AuthSubjectCreationFailedError,
  AuthUserInactiveError,
  MissingRouteGuardError,
  ReauthFailedError,
  type AuthError,
} from './errors';

const failures: ReadonlyArray<readonly [AuthError, string, number]> = [
  [new AuthInvalidTokenError(), 'AUTH_INVALID_TOKEN', 401],
  [new AuthUserInactiveError(), 'AUTH_USER_INACTIVE', 403],
  [new AuthRoleForbiddenError(), 'AUTH_ROLE_FORBIDDEN', 403],
  [new AuthInvalidCredentialsError(), 'AUTH_INVALID_CREDENTIALS', 401],
  [new AuthScopeSelectionRequiredError(), 'AUTH_SCOPE_SELECTION_REQUIRED', 400],
  [new AuthRefreshReuseDetectedError(), 'AUTH_REFRESH_REUSE_DETECTED', 401],
  [new AuthResetTokenInvalidError(), 'AUTH_RESET_TOKEN_INVALID', 400],
  [new AuthResetTokenExpiredError(), 'AUTH_RESET_TOKEN_EXPIRED', 400],
  [new AuthResetTokenConsumedError(), 'AUTH_RESET_TOKEN_CONSUMED', 409],
  [new AuthPasswordPolicyError(), 'AUTH_PASSWORD_POLICY', 422],
  [new AuthSubjectCreationFailedError(), 'AUTH_SUBJECT_CREATION_FAILED', 409],
  [new ReauthFailedError(), 'AUTH_REAUTH_FAILED', 401],
  [new MissingRouteGuardError(), 'INTERNAL_ERROR', 500],
  [new AuthConfigError(), 'INTERNAL_ERROR', 500],
];

describe('auth errors', () => {
  it('each class is one domain failure mode reporting its default code and status', () => {
    for (const [error, code, status] of failures) {
      expect(error).toBeInstanceOf(DomainError);
      expect(error.code).toBe(code);
      expect(ApplicationError.fromDomain(error, AUTH_ERROR_STATUS).statusCode).toBe(status);
    }
  });

  it('an override changes the code without changing the class', () => {
    const error = new AuthInvalidTokenError(undefined, 'AUTH_INVALID_TOKEN_CUSTOM');

    expect(error).toBeInstanceOf(AuthInvalidTokenError);
    expect(error.code).toBe('AUTH_INVALID_TOKEN_CUSTOM');
  });

  it('the re-auth error code is AUTH_REAUTH_FAILED, not a vendor name', () => {
    expect(AUTH_ERROR_CODES.AUTH_REAUTH_FAILED).toBe('AUTH_REAUTH_FAILED');
    expect(new ReauthFailedError().code).toBe('AUTH_REAUTH_FAILED');
  });

  it('package-raised errors default to no criteria, so nothing secret is attached', () => {
    for (const [error] of failures) {
      expect(error.criteria).toBeUndefined();
      // The code is the only thing a package-raised failure serializes; criteria is caller-supplied.
      expect(JSON.stringify(error)).toBe(JSON.stringify({ code: error.code }));
    }
  });

  it('criteria a caller supplies are preserved verbatim', () => {
    const criteria = { field: 'email' };

    expect(new AuthInvalidCredentialsError(criteria).criteria).toBe(criteria);
  });
});
