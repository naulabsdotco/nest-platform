# @naulabs/auth-core

Consumer-agnostic authentication primitives. The package carries mechanism only: the scope model,
the store, the permission catalogue and the password policy are injected through the ports below.

## Implement these ports

A consumer supplies the adapters; the package never compiles one in.

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

`authCoreConfigSchema` pins the JWT key map, the active key id, the issuer, the audience and the
token lifetimes. It fails when the active key id is absent from the key map, and rejects a secret
shorter than 256 bits.
