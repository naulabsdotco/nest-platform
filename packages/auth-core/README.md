# @naulabsco/auth-core

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

`forRoot` requires every seam unless it is named in `deferredSeams` (see [Deferred seams](#deferred-seams)),
and refuses to boot with one missing or with a non-positive TTL or negative reuse grace, mirroring the
config schema. It provides `TokenService`, `PasswordVerifier`,
`RefreshService`, `ResetService`, `AuthService`, the JWT strategy and the three guards, and it
registers the three guards globally in the order `JwtAuthGuard` → `ScopeGuard` → `PermissionGuard` (see
[Guard order](#guard-order)); a consumer does not wire them, so it cannot omit or misorder them. A
consumer may override error codes with `codes: { AUTH_INVALID_TOKEN: '…' }`; the class stays the same
and only the reported code changes. The reference migration is emitted with `emitAuthSql` and belongs
to the consumer (see [Reference SQL](#reference-sql)). A partial environment can defer an adapter seam
instead of stubbing it (see [Deferred seams](#deferred-seams)).

## Deferred seams

An app can boot before every adapter exists. Name the missing ones in `deferredSeams`; only the six
adapter seams are accepted, and `tokenConfig` and the lifetimes are always required.

```ts
AuthCoreModule.forRoot({ ...partial, deferredSeams: ['passwordPolicy', 'resetLinkSink'] });
```

Each deferred seam is a proxy whose members throw `AuthConfigError({ missing: 'passwordPolicy' })` on
first use, so a route that needs it fails closed with a named error instead of `undefined is not a
function`; a `@Public` route boots and works because it reads no seam. A seam that is both provided and
listed is used, not deferred. `deferredSeams` naming anything else fails boot.

`AuthCoreModule.assertSeamsReady(app)` is an optional, explicit gate for an e2e test: it throws
`AuthConfigError({ deferred: ['passwordPolicy', 'resetLinkSink'] })` listing every seam still deferred,
and passes unchanged when the options are complete. That is the full-double composition: the quickstart
above with all six adapters, then `assertSeamsReady` before the suite runs. The reset link's send
failure handler re-throws `AuthConfigError`, because an unconfigured adapter is not a delivery failure
to swallow.

## Implement these ports

A consumer supplies the adapters; the package never compiles one in. The package depends on
`@naulabsco/errors` for the shared error taxonomy; install it alongside.

| Port | The consumer answers |
| --- | --- |
| `AuthStore` | credentials, scopes, refresh and reset rows, and the login-attempt audit — keyed by `subject`, never a product noun; plus subject creation |
| `ScopeResolver<TScope>` | which `scope`/`role` a subject holds |
| `PermissionCatalogue` | the grants for a `scope` + `role` pair |
| `PasswordPolicy` | whether a candidate password is acceptable |
| `Clock` | "now", so expiry and reuse grace are testable |
| `UnitOfWork` | optional: one transaction around the reset flow's consume, hash and revoke |

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

## Password policy

`PasswordPolicy.validate` reports a rejection by throwing `AuthPasswordPolicyError` with
`criteria: { problems: [{ rule, detail? }] }` — `detail` is optional and carries the requirement, never
the password. The class reports `AUTH_PASSWORD_POLICY`, `AUTH_ERROR_STATUS` maps that code to **422**,
and the package neither catches nor rewraps the error, so `ApplicationError.fromDomain` keeps the code,
the status and the `problems` list unchanged. `validate` may be async; it is awaited before any state
change in `resetPassword`, so a rejected password leaves the reset token usable and the stored hash
untouched. A throw that is not a `DomainError` becomes a 500 with no detail through
`ApplicationError.fromDomain`; the `@naulabsco/errors` filter still maps a `ZodError` to 400 and passes a
Nest `HttpException` through, so the policy is not the only error path.

```ts
class MinimumLengthPolicy implements PasswordPolicy {
  validate(password: string): void {
    if (password.length < 12) {
      throw new AuthPasswordPolicyError({ problems: [{ rule: 'min-length', detail: '12' }] });
    }
  }
}
```

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

`forRoot` registers the guards in the order `JwtAuthGuard` → `ScopeGuard` → `PermissionGuard`; the
order is mechanism, not preference, because each writes what the next reads, and a consumer cannot
change it. `guardPipeline` inserts consumer guards at the two fixed slots that make sense:
`afterAuth` runs after the JWT guard (on an authenticated route `request.principal` is set) and before
the scope guard; `afterScope` runs after the scope guard (so `request.scope` is set) and before the
permission guard. Both are optional and empty by default, binding stays global, and there is no slot
before `JwtAuthGuard` or after `PermissionGuard`, so a rate limiter in `afterAuth` still sees a request
the permission guard will deny. A listed entry is either a guard class or a guard instance: a class is
resolved in auth-core's injector, so it must be dependency-free, and a guard that needs a consumer
provider must be passed as an instance. An unknown slot, a non-array value or an entry that is neither a
class nor an object fails boot with `AuthConfigError`. A `@Public` route still runs an inserted guard,
but no principal or scope exists there, so a guard that reads `request.principal` must skip it.
`JwtAuthGuard` takes the bearer
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

`RefreshService.issue({ subjectId, scope?, userAgent?, ip?, familyId? })` mints 32 random bytes
(base64url) and stores only their SHA-256 hex. A fresh `familyId` is minted unless one is supplied;
`familyId` is for the package's own rotation and must never be taken from a request, or a caller could
attach a row to another subject's family. `login` forwards the resolved scope and the request's user
agent and ip, and a value the caller omits is stored as null by the adapter. The user agent is capped at
512 characters and an ip that is not an IP literal is dropped, so neither header can amplify storage or
fail the write after the access token was minted. `issue('subject-id')` remains valid and carries no
request metadata. `rotate(presented)` hashes the presented token and looks the hash up — no plaintext
column exists. A live token is marked used atomically and replaced in the same family, which also
continues the row's `scope`, so a rotated token never forces a new selection. A token consumed within
`reuseGraceSeconds` re-issues in the family without revoking, because the plaintext is never stored,
so the re-issue is a new token rather than the same one. A token consumed outside the grace, or one
already revoked, revokes the entire family and throws `AuthRefreshReuseDetectedError`, and a consumed
token is judged for reuse before expiry, so a replay after expiry still revokes. An expired token that
was never used, or an unknown one, throws `AuthInvalidTokenError`. Losing the `markRefreshUsed`
compare-and-set re-reads the row and applies the same grace. After a successful rotation the service
re-reads the presented row: if a concurrent logout revoked the family, it revokes it again — which
also kills the row just minted — and throws.

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
one throws `AuthResetTokenExpiredError`. A successful consume also spends **every other live link for
the subject**, so an older email cannot be replayed after a reset. On success it stores an argon2id
hash and revokes every refresh family for the subject. The token is never a JWT, and only its hash
reaches the store.

`unitOfWork` makes the consume, the hash replacement and the refresh revocation one transaction:
`ResetService` calls `unitOfWork.transaction(work)` with an opaque `AuthTransaction` and passes that
value to the three writes (`consumeResetToken`, `replaceCredentialHash`, `revokeRefreshForSubjects`);
the pre-transaction `findResetToken` read carries none. The adapter must run those three writes on the
same transaction, make `consumeResetToken` spend every live row for the subject in one
statement, and roll back on any throw. Without a `UnitOfWork` the three writes stay sequential and the
adapter must make them atomic itself: a failure between them can spend the token without changing the
password, or change the password while a refresh family survives. The result of `forgotPassword` is
identical for a known and an unknown address, but the timing is not constant — the known path also
writes and sends — so it is a result guarantee, not a timing guarantee.

## Login

`AuthService.login({ email, password, scope?, ip?, userAgent? })` verifies the credential and returns
the access token, the refresh token and the resolved `AuthScope`. Every credential failure is the same
`AuthInvalidCredentialsError`, and an unknown email still runs `verifyDummy`, so it does not answer
faster than a wrong password. A `rehash` from the verifier replaces the stored hash. A subject with
one scope gets it; with several, a missing selection throws `AuthScopeSelectionRequiredError` (400),
and a selection the subject does not hold is refused rather than guessed. Every attempt is recorded
with a SHA-256 email hash, never the password or the plaintext address. `refresh(presented)` delegates
to `RefreshService.rotate` and mints a new access token; `logout` revokes the presented token's whole
family, and an unknown token is ignored so logout stays idempotent and does not reveal whether it
existed. `AuthService` takes only the store, verifier, token service and refresh service: the store
stamps attempts, and `ResetService` owns the password policy.

## Creating subjects

`AuthStore.createSubject({ email, credential, scopes })` is the one write an invite, admin or seed
flow makes. It is an **optional** member of the port: existing adapters compile unchanged, and an
adapter that owns creation implements it. The package never calls it; the adapter inserts the subject,
its credential and every scope row in one transaction, so a failure leaves no orphan. A scope's `active` defaults to true. A duplicate email and a scope the
consumer does not know are refused with the same `AuthSubjectCreationFailedError` (409) — the
adapter's own constraint decides which, and the caller sees one typed failure rather than SQL detail.
No plaintext password reaches the port: the consumer hashes it and passes `{ algo, hash }`.

## Reference SQL

`packages/auth-core/sql/` ships five forward-only files — `subject`, `subject_credential`,
`refresh_token`, `password_reset_token` and `login_attempt` — that apply cleanly to a stock
`postgres:17`. No plaintext credential or token column exists: a credential stores `hash` (argon2id by
default) and both tokens store a SHA-256 `token_hash`, uniquely indexed. The refresh row also carries
the nullable `scope`, `user_agent` and `ip` that `RefreshInput` supplies, so rotation can continue the
chosen scope. There is no scope or membership table; the scope model is the consumer's.

`emitAuthSql({ destDir, utc14, ...shape })`, also runnable as
`emit-auth-sql --dest <dir> --utc14 <14 digits> [--config <json>] [--check] [--direction up|down|both] [--verify]`
(or `node node_modules/@naulabsco/auth-core/bin/emit-auth-sql.mjs`), copies each file into the
consumer's migration directory as `<utc14>_<name>.sql`, in the reference order. It never executes
them and refuses to overwrite an existing target, so a second emit fails loudly instead of silently
replacing a file; a write that fails midway removes the files that run created. **The consumer owns
the migration** — its forward file, rollback, verification and schema assertions; the package never
runs a migration or connects as an elevated role.

`direction: 'down'` adds one `<utc14>_<name>.down.sql` per table, a `DROP TABLE IF EXISTS` ordered so
the child tables go first; `'both'` emits the up set, then the verify file, then the down set, so the
returned order can be applied as-is. **Apply the returned array**, not a filename sort: every file
shares the `utc14` prefix, and neither the foreign-key order nor the up/verify/down order is encoded in
the name. `verify: true` adds `<utc14>_verify.sql`, a `DO` block that
raises when a table, a hashed column or the partition is missing, or a disabled column is present.
`verify` with a down-only direction is refused. `mode: 'check'` writes nothing and returns
`{ path, status: 'missing' | 'differs' | 'in-sync' }` per planned file; `--check` prints that line per
file and exits 1 when any file is not in sync, 0 otherwise. Write mode keeps the overwrite refusal.

The optional `shape` renames tables, removes credential columns and partitions the attempt table. An
omitted key keeps today's output byte-for-byte; the value must be a lowercase SQL identifier, because
it is interpolated into the emitted SQL, and two tables cannot map to the same name. Every identifier
that contains a renamed table as a whole underscore segment follows it — `<name>_id` columns, compound
index names and the table itself — while the file names keep the reference names and the set is
returned in reference order. A rename that would push any derived identifier past PostgreSQL's 63-byte
limit is refused rather than silently truncated. Unknown `columns` keys and non-boolean values are
refused, so a typo cannot leave a column you meant to remove.

`loginAttempt.partitioned` only emits `PARTITION BY RANGE (column)`: the consumer must create the
partitions (or a default partition) before inserting, or every attempt insert fails with "no partition
of relation found for row".

| Option | Default | Effect |
| --- | --- | --- |
| `tables.subject` | `subject` | the subject table, and every `subject_*` column or index |
| `tables.credential` | `subject_credential` | the credential table |
| `tables.refreshToken` | `refresh_token` | the refresh table and its index names |
| `tables.resetToken` | `password_reset_token` | the reset table and its index names |
| `tables.loginAttempt` | `login_attempt` | the attempt table and its index name |
| `columns.credential.sourceUpdatedAt` | `true` | keep `source_updated_at` |
| `columns.credential.failedCount` | `true` | keep `failed_count` |
| `columns.credential.lockedUntil` | `true` | keep `locked_until` |
| `loginAttempt.partitioned` | absent | `{ by: 'range', column: 'at' }` adds `PARTITION BY RANGE` |

```ts
await emitAuthSql({
  destDir, utc14,
  tables: { subject: 'accounts', credential: 'user_credentials' },
  columns: { credential: { failedCount: false } },
  loginAttempt: { partitioned: { by: 'range', column: 'at' } },
});
```

`--config` takes the same `tables`, `columns` and `loginAttempt` object from a JSON file, and may also
carry `mode`, `direction` and `verify`; an explicit `--check`, `--direction` or `--verify` wins.

## Release gate

`@naulabsco/auth-core` publishes only after the review in
[`docs/auth-core-security-review.md`](../../docs/auth-core-security-review.md) is signed. The release
workflow fails when the signer or date is empty, or when a review row names a test that no longer
exists.
