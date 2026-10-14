# @naulabs/auth-core

Consumer-agnostic authentication primitives. The package carries mechanism only: the scope model,
the store, the permission catalogue and the password policy are injected through the ports below.

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

`AuthScope` is `{ subject, scope, role }`; the meaning of `scope` and `role` is the consumer's.

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



