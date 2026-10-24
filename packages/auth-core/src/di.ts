import { AUTH_ERROR_CODES, type AuthErrorCode } from './errors';

// Internal wiring tokens: the module binds them and the guards read them. None is exported from the
// barrel, so a consumer wires ports and never these.
export const AUTH_CODES = Symbol('AUTH_CODES');
export const AUTH_OPTIONS = Symbol('AUTH_OPTIONS');
export const TOKEN_SERVICE = Symbol('AUTH_TOKEN_SERVICE');
export const PASSWORD_VERIFIER = Symbol('AUTH_PASSWORD_VERIFIER');
export const JWT_STRATEGY = Symbol('AUTH_JWT_STRATEGY');
export const SCOPE_RESOLVER = Symbol('AUTH_SCOPE_RESOLVER');
export const PERMISSION_CATALOGUE = Symbol('AUTH_PERMISSION_CATALOGUE');
export const DEFERRED_SEAMS = Symbol('AUTH_DEFERRED_SEAMS');
export const DEFERRED_SEAM = Symbol('AUTH_DEFERRED_SEAM');

// `Record`, not `typeof AUTH_ERROR_CODES`: the literal type would reject an overridden value.
export type AuthCodeMap = Record<AuthErrorCode, string>;

export const resolveCodes = (overrides?: Partial<AuthCodeMap>): AuthCodeMap => ({
  ...AUTH_ERROR_CODES,
  ...overrides,
});
