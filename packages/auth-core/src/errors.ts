import { DomainError, type StatusMap } from '@naulabs/errors';

export const AUTH_ERROR_CODES = {
  AUTH_INVALID_TOKEN: 'AUTH_INVALID_TOKEN',
  AUTH_USER_INACTIVE: 'AUTH_USER_INACTIVE',
  AUTH_ROLE_FORBIDDEN: 'AUTH_ROLE_FORBIDDEN',
  AUTH_INVALID_CREDENTIALS: 'AUTH_INVALID_CREDENTIALS',
  AUTH_SCOPE_SELECTION_REQUIRED: 'AUTH_SCOPE_SELECTION_REQUIRED',
  AUTH_REFRESH_REUSE_DETECTED: 'AUTH_REFRESH_REUSE_DETECTED',
  AUTH_RESET_TOKEN_INVALID: 'AUTH_RESET_TOKEN_INVALID',
  AUTH_RESET_TOKEN_EXPIRED: 'AUTH_RESET_TOKEN_EXPIRED',
  AUTH_RESET_TOKEN_CONSUMED: 'AUTH_RESET_TOKEN_CONSUMED',
  AUTH_PASSWORD_POLICY: 'AUTH_PASSWORD_POLICY',
  AUTH_REAUTH_FAILED: 'AUTH_REAUTH_FAILED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type AuthErrorCode = (typeof AUTH_ERROR_CODES)[keyof typeof AUTH_ERROR_CODES];

// INTERNAL_ERROR is deliberately absent: fromDomain fails an unmapped code closed to a 500.
export const AUTH_ERROR_STATUS: StatusMap<AuthErrorCode> = {
  AUTH_INVALID_TOKEN: 401,
  AUTH_USER_INACTIVE: 403,
  AUTH_ROLE_FORBIDDEN: 403,
  AUTH_INVALID_CREDENTIALS: 401,
  AUTH_SCOPE_SELECTION_REQUIRED: 400,
  AUTH_REFRESH_REUSE_DETECTED: 401,
  AUTH_RESET_TOKEN_INVALID: 400,
  AUTH_RESET_TOKEN_EXPIRED: 400,
  AUTH_RESET_TOKEN_CONSUMED: 409,
  AUTH_PASSWORD_POLICY: 422,
  AUTH_REAUTH_FAILED: 401,
};

export abstract class AuthError extends DomainError {
  constructor(defaultCode: AuthErrorCode, criteria?: unknown, code?: string) {
    super(criteria);
    this.code = code ?? defaultCode;
  }

  readonly code: string;
}

export class AuthInvalidTokenError extends AuthError {
  constructor(criteria?: unknown, code?: string) {
    super(AUTH_ERROR_CODES.AUTH_INVALID_TOKEN, criteria, code);
  }
}

export class AuthUserInactiveError extends AuthError {
  constructor(criteria?: unknown, code?: string) {
    super(AUTH_ERROR_CODES.AUTH_USER_INACTIVE, criteria, code);
  }
}

export class AuthRoleForbiddenError extends AuthError {
  constructor(criteria?: unknown, code?: string) {
    super(AUTH_ERROR_CODES.AUTH_ROLE_FORBIDDEN, criteria, code);
  }
}

export class AuthInvalidCredentialsError extends AuthError {
  constructor(criteria?: unknown, code?: string) {
    super(AUTH_ERROR_CODES.AUTH_INVALID_CREDENTIALS, criteria, code);
  }
}

export class AuthScopeSelectionRequiredError extends AuthError {
  constructor(criteria?: unknown, code?: string) {
    super(AUTH_ERROR_CODES.AUTH_SCOPE_SELECTION_REQUIRED, criteria, code);
  }
}

export class AuthRefreshReuseDetectedError extends AuthError {
  constructor(criteria?: unknown, code?: string) {
    super(AUTH_ERROR_CODES.AUTH_REFRESH_REUSE_DETECTED, criteria, code);
  }
}

export class AuthResetTokenInvalidError extends AuthError {
  constructor(criteria?: unknown, code?: string) {
    super(AUTH_ERROR_CODES.AUTH_RESET_TOKEN_INVALID, criteria, code);
  }
}

export class AuthResetTokenExpiredError extends AuthError {
  constructor(criteria?: unknown, code?: string) {
    super(AUTH_ERROR_CODES.AUTH_RESET_TOKEN_EXPIRED, criteria, code);
  }
}

export class AuthResetTokenConsumedError extends AuthError {
  constructor(criteria?: unknown, code?: string) {
    super(AUTH_ERROR_CODES.AUTH_RESET_TOKEN_CONSUMED, criteria, code);
  }
}

export class AuthPasswordPolicyError extends AuthError {
  constructor(criteria?: unknown, code?: string) {
    super(AUTH_ERROR_CODES.AUTH_PASSWORD_POLICY, criteria, code);
  }
}

export class ReauthFailedError extends AuthError {
  constructor(criteria?: unknown, code?: string) {
    super(AUTH_ERROR_CODES.AUTH_REAUTH_FAILED, criteria, code);
  }
}

export class MissingRouteGuardError extends AuthError {
  constructor(criteria?: unknown, code?: string) {
    super(AUTH_ERROR_CODES.INTERNAL_ERROR, criteria, code);
  }
}
