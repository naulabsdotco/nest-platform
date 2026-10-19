# @naulabs/auth-core

Consumer-agnostic authentication primitives. The package carries mechanism only: the scope model,
the store, the permission catalogue and the password policy are injected through the ports below.

## Quickstart

```ts
AuthCoreModule.forRoot({
  store,
  scopeResolver,
  permissionCatalogue,
  clock,
  passwordPolicy,
  resetLinkSink,
  tokenConfig: { keys, activeKid, issuer, audience, accessTtlSeconds },
  reuseGraceSeconds: 10,
  refreshTtlSeconds: 2_592_000,
  resetTtlMinutes: 20,
});
```

`forRoot` requires every seam and refuses to boot with one missing. It provides `TokenService`,
`PasswordVerifier`, `RefreshService`, `ResetService`, `AuthService`, the JWT strategy and the three
guards. It does not register the guards globally: add them as `APP_GUARD` providers in the order
`JwtAuthGuard` → `ScopeGuard` → `PermissionGuard` (see [Guard order](#guard-order)). A consumer may
override error codes with `codes: { AUTH_INVALID_TOKEN: '…' }`; the class stays the same and only the
reported code changes. The reference migration is emitted with `emitAuthSql` and belongs to the
consumer (see [Reference SQL](#reference-sql)).

## Implement these ports

A consumer supplies the adapters; the package never compiles one in. The package depends on
`@naulabs/errors` for the shared error taxonomy; install it alongside.

| Port | The consumer answers |
| --- | --- |
| `AuthStore` | credentials, scopes, refresh and reset rows, and the login-attempt audit — keyed by `subject`, never a product noun |
| `ScopeResolver<TScope>` | which `scope`/`role` a subject holds |
| `PermissionCatalogue` | the grants for a `scope` + `role` pair |
| `PasswordPolicy` | whether a candidate password is acceptable |
| `Clock` | "now", so expiry and reuse grace are testable |

`AuthScope` is `{ subject, scope, role, active }`; the meaning of `scope` and `role` is the consumer's.

## Error codes

`AUTH_ERROR_CODES` is the default vocabulary and is overridable per module. Each failure mode is one
`DomainError` class; `AUTH_ERROR_STATUS` maps the codes to HTTP statuses for `ApplicationError.fromDomain`.

## Config

`authCoreConfigSchema` pins the JWT key map, the active key id, the issuer, the audience and the token
lifetimes. It fails when the active key id is absent from the key map, rejects a secret that is short
or low-diversity, and bounds each lifetime. Generate a key with `openssl rand -base64 32`; the
`audience` must be unique to this deployment, because HS256 verifies anywhere that shares a secret.

## Passwords

`createPasswordVerifier()` hashes with argon2id at the pinned `ARGON2_OPTIONS`. The bcrypt path is
**off by default**: a `bcrypt` credential is refused unless the verifier is created with
`createPasswordVerifier({ bcrypt: true })`, and a successful bcrypt verify returns an argon2id
`rehash` to store. `hash()` only ever emits argon2id, so an imported scheme cannot become the default.
bcrypt is an optional peer, loaded only when opted in, so a consumer that never enables it does not
build that native module. Note that bcrypt truncates a password at 72 bytes. Both schemes are native
modules: a consumer's package manager must be allowed to run their install scripts.

## Tokens

`createTokenService(cfg)` signs HS256 access tokens pinned to the active kid, `iss` and `aud`, with the
payload `{ sub, typ: 'access' }` and nothing else — no scope, role or email, so changing authorization
needs no token revocation. `verifyAccess` returns `{ sub }` and throws `AuthInvalidTokenError` on every
failure. Rotating `activeKid` keeps old tokens verifying while the key map still holds their key.
`verifyAccess` returns `{ sub }` only, so any extra claim a token carries is never trusted; `iss` is
matched exactly and `aud` may be a string or an array containing the configured audience. An access
token cannot be revoked, so keep its TTL short and pair it with the refresh flow.

## Route metadata

`Public()`, `Authenticated()` and `RequirePermission(id)` attach the three keys the guards read;
`RequirePermission` refuses an empty id. `resolveRoutePolicy(reflector, handler, controller)` returns
the effective policy, the handler replacing its class wholesale, so a class-level `@Public` never
relaxes a handler that asks for more — a mix `assertEveryRouteGuarded(app)` refuses. That helper walks
every controller route, inherited ones included, and throws `MissingRouteGuardError` listing each route
that carries none of the keys: default-deny made checkable by a consumer's own test.

## Guard order

Register the guards in the order `JwtAuthGuard` → `ScopeGuard` → `PermissionGuard`; the order is
mechanism, not preference, because each writes what the next reads. `JwtAuthGuard` takes the bearer
token from the `Authorization` header only, verifies it against the pinned `algorithms`, `issuer` and
`audience` with `ignoreExpiration: false`, requires `typ: 'access'`, and writes `{ sub }` to
`request.principal` — no other claim is trusted, so a scope in the token is ignored. A `@Public` route
skips verification and therefore carries no principal; a downstream guard must not assume one.
Every other failure is one `AuthInvalidTokenError` (401), never the reason. The
strategy accepts any `kid` still present in the key map, so rotating `activeKid` keeps old access
tokens verifying; `createJwtStrategy` refuses a key map whose active `kid` is absent or whose secret
is weak, like the token service.

## Scope and permissions

`ScopeGuard` calls the injected `ScopeResolver` with the verified `sub` and writes the resolved
`AuthScope` to `request.scope`; a missing row is `AuthInvalidTokenError` (401) and a scope whose
`active` is false is `AuthUserInactiveError` (403). `AuthScope.active` is required, not optional, so a
resolver that forgets it fails to compile rather than read as active. The guard never looks at the
token's other claims, so a scope there cannot override the resolver.

`PermissionGuard` reads `request.scope`, calls `PermissionCatalogue.grantsFor(scope, role)` once per
request, and satisfies `@RequirePermission(id)` only with a grant containing that exact id —
otherwise `AuthRoleForbiddenError` (403). `@Authenticated` is allowed without reading the catalogue but
only when a verified principal is present, so a missing JWT guard fails closed rather than through.
`@Public` is allowed outright. A route that carries none of the three keys is refused with
`MissingRouteGuardError`, so default-deny holds even when the guards are not bound.

## Refresh

`RefreshService.issue(subjectId)` mints 32 random bytes (base64url) and stores only their SHA-256 hex
with a fresh `familyId`. `rotate(presented)` hashes the presented token and looks the hash up — no
plaintext column exists. A live token is marked used atomically and replaced in the same family. A
token consumed within `reuseGraceSeconds` re-issues in the family without revoking, because the
plaintext is never stored, so the re-issue is a new token rather than the same one. A token consumed
outside the grace, or one already revoked, revokes the entire family and throws
`AuthRefreshReuseDetectedError`, and a consumed token is judged for reuse before expiry, so a replay
after expiry still revokes. An expired token that was never used, or an unknown one, throws
`AuthInvalidTokenError`. Losing the `markRefreshUsed` compare-and-set re-reads the row and applies the
same grace. After a successful rotation the service re-reads the presented row: if a concurrent logout
revoked the family, it revokes it again — which also kills the row just minted — and throws.

The store's `markRefreshUsed` must compare-and-set on `used_at IS NULL AND revoked_at IS NULL`. That
CAS closes the read/CAS race; the post-rotation re-read is a compensating check. An adapter that needs
the remaining window closed must serialize `issueRefresh` and `revokeRefreshFamily` on the family (a
lock or a family row). Reuse detection logs the `auth.refresh.reuse_detected` event with the `event`
and `outcome` fields and never the token.

## Reset

`ResetService.forgotPassword(email)` returns the same empty result whether the address is known or not.
For a known subject it mints 32 random bytes, stores only the SHA-256 with a bounded expiry, and hands
the token to the injected `ResetLinkSink`; an unknown address writes nothing and sends nothing. A failed
send is logged as `auth.reset.link_failed` and swallowed so it cannot become an enumeration oracle.
`resetPassword(token, newPassword)` runs the `PasswordPolicy` before touching any state, then consumes
the token through a compare-and-set: a second consume throws `AuthResetTokenConsumedError`, an expired
one throws `AuthResetTokenExpiredError`. On success it stores an argon2id hash and revokes every refresh
family for the subject. The token is never a JWT, and only its hash reaches the store.

`consumeResetToken`, `replaceCredentialHash` and `revokeRefreshForSubjects` are three independent port
calls with no transaction seam: if the store fails between them, the token may be spent without the
password changing, or the password may change while a refresh family survives. An adapter that needs
all-or-nothing must make those three writes atomic itself. The result of `forgotPassword` is identical
for a known and an unknown address, but the timing is not constant — the known path also writes and
sends — so it is a result guarantee, not a timing guarantee.

## Login

`AuthService.login({ email, password, scope?, ip? })` verifies the credential and returns the access
token, the refresh token and the resolved `AuthScope`. Every credential failure is the same
`AuthInvalidCredentialsError`, and an unknown email still runs `verifyDummy`, so it does not answer
faster than a wrong password. A `rehash` from the verifier replaces the stored hash. A subject with
one scope gets it; with several, a missing selection throws `AuthScopeSelectionRequiredError` (400),
and a selection the subject does not hold is refused rather than guessed. Every attempt is recorded
with a SHA-256 email hash, never the password or the plaintext address. `refresh(presented)` delegates
to `RefreshService.rotate` and mints a new access token; `logout` revokes the presented token's whole
family, and an unknown token is ignored so logout stays idempotent and does not reveal whether it
existed. `AuthService` takes only the store, verifier, token service and refresh service: the store
stamps attempts, and `ResetService` owns the password policy.

## Reference SQL

`packages/auth-core/sql/` ships five forward-only files — `subject`, `subject_credential`,
`refresh_token`, `password_reset_token` and `login_attempt` — that apply cleanly to a stock
`postgres:17`. No plaintext credential or token column exists: a credential stores `hash` (argon2id by
default) and both tokens store a SHA-256 `token_hash`, uniquely indexed. There is no scope or
membership table; the scope model is the consumer's.

`emitAuthSql({ destDir, utc14 })`, also runnable as
`emit-auth-sql --dest <dir> --utc14 <14 digits>` (or
`node node_modules/@naulabs/auth-core/bin/emit-auth-sql.mjs`), copies
each file into the consumer's migration directory as `<utc14>_<name>.sql`. It never executes them and
refuses to overwrite an existing target, so a second emit fails loudly instead of silently replacing a
file; a write that fails midway removes the files that run created. **The consumer owns the migration**
— its forward file, rollback, verification and schema assertions; the package never runs a migration or
connects as an elevated role.



