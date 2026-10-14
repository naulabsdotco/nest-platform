# nest-platform

Consumer-agnostic NestJS building blocks, published to public npm under `@naulabs/*` and licensed MIT.

Every package carries **mechanism only**. The consumer-specific decisions — what a scope means, which
role may do what, what an error is called, what an error response looks like — are injected through a
port or a serializer, never compiled in.

## Packages

| Package | What it provides |
| --- | --- |
| `@naulabs/config` | Zod environment loader: parse and fail at boot, values never echoed. |
| `@naulabs/logging` | `pino`/`nestjs-pino` logger with a correlation id and a redaction list a consumer can extend but not empty. |
| `@naulabs/errors` | Domain/application error taxonomy, `ApplicationError.fromDomain`, and an HTTP exception filter with a pluggable envelope serializer. |
| `@naulabs/auth-core` | A pinned JWT strategy factory, an argon2id password verifier, an access-token service, refresh rotation with reuse detection, a single-use hashed reset token, `AuthStore`/`ScopeResolver`/`PermissionCatalogue` ports, and guards (`JwtAuth → Scope → Permission`) that default to deny. |

## Status

Pre-release. The repository is bootstrapped and the work is planned as tickets; there is no package
code yet. See [`docs/spec.md`](docs/spec.md) for the specification.

## Conventions

See [`CLAUDE.md`](CLAUDE.md). [`AGENTS.md`](AGENTS.md) points at it.
