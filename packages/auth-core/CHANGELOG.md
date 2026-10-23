# @naulabsco/auth-core

## 0.1.0

### Minor Changes

- 3b53dfd: Add `AuthService`: login verifies the credential, runs a dummy verify for an unknown email, returns the access token, refresh token and resolved scope, and records every attempt with a hashed email; refresh and logout delegate to `RefreshService`.
- 3393054: Reject low-diversity or short JWT secrets, bound every token lifetime, and resolve `workspace:` ranges when packing.
- 26010f9: Add `createJwtStrategy` and `JwtAuthGuard`: the pinned `algorithms`, `issuer` and `audience` are required options, `validate` returns `{ sub }` only, and every failure is one `AuthInvalidTokenError`.
- dff4789: Add `AuthCoreModule.forRoot`, which takes every consumer seam, refuses to boot without one, provides the token service, password verifier, refresh, reset and auth services, registers the JWT strategy and the three guards globally in order, and binds an overridable error-code map.
- 8d0c38d: Add the argon2id password verifier with pinned parameters and an opt-in bcrypt path that rehashes to argon2id.
- f671a70: Add the consumer ports, the overridable auth error codes with their status map, and the pinned JWT config schema.
- 3f409af: Add the versioned reference SQL (subject, credential, refresh, reset and login-attempt tables, hashed only) and `emitAuthSql`, which writes `<utc14>_<name>.sql` into a consumer's migration directory and refuses to overwrite.
- 06f7648: Add `RefreshService`: refresh tokens are 32 random bytes stored as SHA-256 hex, a valid token rotates within its family, and reuse outside the grace revokes the whole family with `AuthRefreshReuseDetectedError`.
- 02c9360: Add `ResetService` and `ResetLinkSink`: a reset token is 32 random bytes stored as SHA-256 hex, the password policy runs before any state change, a consume is single-use, and a successful reset revokes every refresh family for the subject.
- 00214c5: Add the route metadata decorators and `assertEveryRouteGuarded`, which fails a route that carries none of the three guard keys.
- 37d02d9: Add `ScopeGuard` and `PermissionGuard`: the resolved scope is written to the request, an inactive scope is refused with 403, and a route that names none of the three keys fails closed with `MissingRouteGuardError`.
- 7114cf1: Add an HS256 access-token service whose payload is `{ sub, typ: 'access' }` only, pinned to the active kid, issuer and audience.
- 9915d6b: Publish `@naulabsco/auth-core@0.1.0` only past the signed security review in
  `docs/auth-core-security-review.md`.

### Patch Changes

- Updated dependencies [ba2f0ad]
- Updated dependencies [2f60ede]
- Updated dependencies [8e218f3]
  - @naulabsco/errors@0.1.0
