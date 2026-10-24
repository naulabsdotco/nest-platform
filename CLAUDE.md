# nest-platform — agent guide

A public, MIT-licensed set of NestJS building blocks published to npm as `@naulabsco/*`. This file is
the repo convention; it is not a copy of the spec. Read [`docs/spec.md`](docs/spec.md) for what the
packages are.

## The hard rule: mechanism only

No committed file, ticket, commit, test name, example or comment may name or describe a consuming
product or its domain. Use neutral vocabulary: `subject`, `scope`, `role`, `permission`. Examples use
`example-app`. A package exposes a **port** or a **serializer** where a consumer decision belongs; it
never compiles one in.

- The scope model is the consumer's. The package knows a `subject` and an opaque `scope` string.
- Error codes, the response envelope, roles and permissions, claims beyond `{ sub, typ }` — injected.
- No package runs a migration, connects as an elevated role, or ships a consumer's table verbatim.

## Layering (DDD-Lite)

Per package, dependencies point inward:

```
domain  →  nothing external
ports   →  domain
adapters/infrastructure → ports, framework, driver
```

Value objects, entities and ports live in `domain`/`ports`; use cases in `application`; Nest and
drivers in `infrastructure`. A port imports no `@nestjs/*` and no database driver. Domain errors are
plain `Error` subclasses, one class per failure mode, colocated in one `errors.ts` per layer.
Translation to `ApplicationError` happens only at the application boundary (`fromDomain`), never
inside the error that was raised. Never reuse one generic class across two failure modes; never throw
a bare `new Error(...)` from a guard or adapter.

## Delivery

- **TDD, strictly.** No production code before a failing test exists for it. Name cases for happy,
  error, edge and security behaviour. A test that fails for the wrong reason is worse than no test.
- **Vertical slices.** Each ticket delivers one usable, tested capability end to end: exported API +
  tests + the README section it belongs to. Not a layer.
- **Small PRs.** Target ≤200 changed lines; 500 is the hard cap (lockfiles excluded). Over 200 says
  why in the body; over 500 it is a stack.
- **One concern per commit.** Conventional Commits title, imperative, under ~72 characters. Branch
  per ticket, never commit to `main` directly.

## Packaging

Each package ships **dual ESM + CJS**. `exports` carries `import`, `require` and the `@naulabsco/source`
dev condition, each with a `dist` fallback; the build emits both formats plus declaration files and
source maps. `pack-smoke` must `require()` **and** `import` every packed tarball.

## Code budget

Prefer a dependency over a hand-rolled abstraction: Nest built-ins, `passport-jwt`, `argon2`,
`pino`/`nestjs-pino`, Zod, `changesets`. A new abstraction needs a stated reason it could not be a
dependency. **Few comments**: only what the code cannot say — a non-obvious invariant, a trap, a
rejected alternative. Tiebreak is delete.

## Auth security invariants (`@naulabsco/auth-core`)

- JWT strategy pins `algorithms`, `issuer`, `audience` and `ignoreExpiration: false`; all four are
  **required** options. `validate()` returns `{ sub }` only.
- Argon2id params are pinned; a credential whose scheme is not enabled is refused; the optional
  bcrypt-verify → argon2id-rehash path is **off by default**.
- Refresh tokens: 32 random bytes, stored as SHA-256 hex; a consumed token outside the reuse grace
  revokes the whole family; inside grace it re-issues idempotently.
- The reset token is single-use, hashed, never a JWT, and revokes every refresh family for the
  subject on success. The password policy is checked before any state change.
- Compare secrets timing-safe. `DEFAULT_REDACT_PATHS` covers credentials, tokens and SQL parameters;
  a consumer may add paths but never empty the list.
- The re-authentication code is `AUTH_REAUTH_FAILED`; no vendor-style naming anywhere.

## SQL and migrations

Authentication tables ship as versioned SQL files inside `auth-core`, plus an emit helper that copies
them into a consumer's migration directory as `<utc14>_<name>.sql` and refuses to overwrite. The
package never executes them. The consumer owns its forward migration, its rollback, its verification
and its schema assertions.

## Release

Semver + changesets; the four packages share one version so a partial upgrade cannot happen.
Consumers pin exact versions; upgrades arrive as bot PRs. Publishing targets **public npm** under
`@naulabsco/*` with provenance. A bot pull request from `changeset-release/main` carries the version
commit; nothing pushes to `main` directly. Three steps are manual and human-owned: the `@naulabsco` npm
organisation must exist, an `NPM_TOKEN` repository secret must be set, and a fine-grained `RELEASE_TOKEN`
(contents + pull-requests write) must be set so CI runs on the release pull request. Actions must also
be allowed to create pull requests at organisation and repository level. A release ticket says so.
