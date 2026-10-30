# @naulabsco/auth-core

## 0.2.0

### Minor Changes

- 45417bd: Add `check`, `down` and `verify` modes to `emitAuthSql`: check reports `missing`, `differs` or `in-sync` per file without writing, down emits `DROP TABLE IF EXISTS` files in reverse foreign-key order, and verify emits schema assertions to apply after the up set. `--check` exits 1 on any difference.
- a1b3d92: Let `emitAuthSql` take an optional shape: renamed tables (with their foreign keys and index names following), removed optional credential columns, and a partitioned login-attempt table. Omitted options keep the reference output byte-for-byte, and the bin reads the same object from `--config`.
- ed24faa: Add an optional `AuthStore.createSubject({ email, credential, scopes })`: when an adapter implements it, one call writes the subject, its credential and every scope row in one transaction, with `active` defaulting to true. A duplicate email or an unknown scope surfaces as one `AuthSubjectCreationFailedError` (409), no plaintext password reaches the port, and existing adapters compile unchanged because the member is optional.
- 40a3762: Allow deferred adapter seams in `forRoot`: naming a missing seam in `deferredSeams` makes exactly that seam optional in the options type and boots with a proxy that throws `AuthConfigError({ missing })` on first use, while `tokenConfig` and the lifetimes stay required. `AuthCoreModule.assertSeamsReady(app)` lists every seam still deferred, a provided adapter wins over its deferral, and a deferred reset sink fails loudly instead of being swallowed as a delivery error.
- c0d546e: Add `guardPipeline` to `AuthCoreModule.forRoot`: a consumer guard can run after the JWT guard and before the scope guard (`afterAuth`) or after the scope guard and before the permission guard (`afterScope`). Binding stays global and the built-in relative order cannot change; an unknown slot fails boot.
- 120402a: Carry request metadata through `RefreshService.issue`: it now takes `{ subjectId, scope?, userAgent?, ip?, familyId? }` (a plain subject id still works), `login` forwards the resolved scope plus the user agent and ip, a supplied `familyId` is reused, and rotation continues the family and its scope. The user agent is capped at 512 characters, a malformed ip is dropped, the reference refresh table gains a nullable `scope` column, and `RefreshRecord` exposes the optional `scope`.
- 69cd720: Add an optional `UnitOfWork` seam: `resetPassword` runs the consume, the hash replacement and the refresh revocation in one transaction when one is injected, and `consumeResetToken` now spends every live reset link for the subject. `AuthStore` methods take the transaction as an optional trailing argument; without a `UnitOfWork` the sequential path is unchanged.

### Patch Changes

- 4693e8d: Document the `PasswordPolicy` rejection convention: throw `AuthPasswordPolicyError` with `{ problems: [{ rule, detail? }] }`. The code is `AUTH_PASSWORD_POLICY`, the status map gives 422, `fromDomain` keeps the list, and the policy runs before any state change. No runtime surface changes.
- Updated dependencies [8485dee]
  - @naulabsco/errors@0.2.0

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
