# nest-platform

Consumer-agnostic NestJS building blocks, published to public npm under `@naulabsco/*` and licensed MIT.

Every package carries **mechanism only**. The consumer-specific decisions — what a scope means, which
role may do what, what an error is called, what an error response looks like — are injected through a
port or a serializer, never compiled in.

## Packages

| Package | What it provides |
| --- | --- |
| `@naulabsco/config` | Zod environment loader: parse and fail at boot, values never echoed. |
| `@naulabsco/logging` | `pino`/`nestjs-pino` logger with a correlation id and a redaction list a consumer can extend but not empty. |
| `@naulabsco/errors` | Domain/application error taxonomy, `ApplicationError.fromDomain`, and an HTTP exception filter with a pluggable envelope serializer. |
| `@naulabsco/auth-core` | A pinned JWT strategy factory, an argon2id password verifier, an access-token service, refresh rotation with reuse detection, a single-use hashed reset token, `AuthStore`/`ScopeResolver`/`PermissionCatalogue` ports, and guards (`JwtAuth → Scope → Permission`) that default to deny. |

Each package ships dual ESM + CJS — `exports` carries `import`, `require` and a `@naulabsco/source` dev
condition — so both `import` and `require` consumers resolve the same surface.

## Status

Pre-release. The repository is bootstrapped and the work is planned as tickets; there is no package
code yet. See [`docs/spec.md`](docs/spec.md) for the specification.

## Conventions

See [`CLAUDE.md`](CLAUDE.md). [`AGENTS.md`](AGENTS.md) points at it.

## Release

Changesets drive the release; `main` never receives a version commit. While a changeset is pending the
`release` workflow opens and updates a `chore(release): version packages` pull request from
`changeset-release/main`; merging it publishes the four packages to public npm with provenance and tags
the release. The publish job runs in the `npm-publish` environment after the signed `auth-core` security
review, and it skips publishing when `NPM_TOKEN` is absent.

The owner preconditions are manual: create the `@naulabsco` npm organisation, set the `NPM_TOKEN`
repository secret, and set a fine-grained `RELEASE_TOKEN` secret (contents and pull-requests write) so
CI runs on the release pull request — without it the pull request still opens, but close and reopen it
to start `verify`. Allow GitHub Actions to create pull requests at organisation and repository level.
