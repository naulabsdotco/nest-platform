# Spec: nest-platform

| | |
| --- | --- |
| **Status** | Proposed |
| **License** | MIT |
| **Registry** | public npm, scope `@naulabs` |
| **Packages** | `@naulabs/config`, `@naulabs/logging`, `@naulabs/errors`, `@naulabs/auth-core` |
## 1. Objective

Publish the shared mechanism two or more NestJS products would otherwise each rebuild — environment
loading, logging, an error taxonomy, and authentication primitives — as a small, consumer-agnostic
package set. Build the mechanism once; let a consumer own every decision specific to it. Exactly four
packages; anything else stays in the consumer until a third real consumer proves the rule of three.

**Most important property:** a package carries mechanism only — every consumer decision is injected through a port or a serializer, never compiled in.
## 2. Package contract (public surface)

Only `src/index.ts` is exported; anything else may change in a patch. Each package ships **dual ESM + CJS**: `exports` carries `import`, `require` and the `@naulabs/source` dev condition, each with a `dist` fallback; the build emits both formats plus declarations and source maps.
### `@naulabs/config`

```ts
type EnvReader = Record<string, string | undefined>;
class ConfigValidationError extends Error { readonly code = 'CONFIG_INVALID'; readonly missing: readonly string[] }
function loadEnv<T>(schema: z.ZodType<T>, raw?: EnvReader): T;
const APP_CONFIG: InjectionToken<unknown>;
function createConfigModule<T>(schema: z.ZodType<T>, opts?: { raw?: EnvReader }): DynamicModule;
```

The schema is the consumer's; the package owns parse, fail-at-boot and the token. A failure names the
missing keys and never echoes their values.
### `@naulabs/logging`

```ts
const CORRELATION_HEADER = 'x-correlation-id';
const DEFAULT_REDACT_PATHS: readonly string[];
const LOG_FIELDS: readonly ['event', 'correlationId', 'outcome'];
interface LoggerOptions { service: string; level?: string; correlationHeader?: string; redactExtra?: readonly string[]; contextFields?: readonly string[] }
function createLoggerModule(opts: LoggerOptions): DynamicModule;
function correlationMiddleware(opts?: { header?: string }): RequestHandler;
```

Field names are the contract. A consumer adds context fields and redactions; it cannot remove a
default redaction path.
### `@naulabs/errors`

```ts
abstract class DomainError extends Error { abstract readonly code: string; readonly criteria?: unknown }
abstract class ApplicationError extends Error {
  readonly statusCode: number; readonly code: string; readonly criteria?: unknown;
  static fromDomain(e: unknown): ApplicationError;             // the only domain→application translation
}
class InfrastructureError extends ApplicationError {}          // 500; detail never serialized
class NotFoundError extends ApplicationError {}                // 404
class ConflictError extends ApplicationError {}                // 409
class ValidationError extends ApplicationError {}              // 400
class UnauthorizedError extends ApplicationError {}            // 401
class ForbiddenError extends ApplicationError {}               // 403
interface ErrorRequest { readonly method: string; readonly path: string }
interface EnvelopeSerializer { serialize(error: ApplicationError, req: ErrorRequest, timestamp: string): unknown }
function defaultEnvelopeSerializer(): EnvelopeSerializer;
class HttpExceptionFilter implements ExceptionFilter { constructor(serializer: EnvelopeSerializer) }
function createExceptionFilter(serializer: EnvelopeSerializer): Type<ExceptionFilter>;
```

The envelope shape is the consumer's. The filter maps `ApplicationError` to its status/code/criteria,
`ZodError` to 400, and anything else to a 500 `INTERNAL_ERROR` with no detail.
### `@naulabs/auth-core`

```ts
// ports — the consumer implements the adapters
interface Clock { now(): Date }
interface Principal { readonly sub: string }
interface AuthScope { readonly subject: string; readonly scope: string; readonly role: string; readonly active: boolean }
interface StoredCredential { readonly subjectId: string; readonly algo: 'argon2id' | 'bcrypt'; readonly hash: string }
interface RefreshRecord { readonly id: string; readonly familyId: string; readonly subjectId: string; readonly expiresAt: Date; readonly usedAt: Date | null; readonly revokedAt: Date | null }
interface ResetRecord { readonly id: string; readonly subjectId: string; readonly expiresAt: Date; readonly consumedAt: Date | null }
interface LoginAttempt { readonly emailHash: string; readonly ip: string; readonly outcome: string; readonly reason?: string }
interface AuthStore { /* findCredentialByEmail, findScopesByEmail, replaceCredentialHash, issueRefresh, findRefreshByHash, markRefreshUsed, revokeRefreshFamily, revokeRefreshForSubjects, issueResetToken, findResetToken, consumeResetToken, recordLoginAttempt */ }
interface ScopeResolver<TScope extends AuthScope = AuthScope> { resolve(sub: string): Promise<TScope | null> }
interface PermissionCatalogue { grantsFor(scope: string, role: string): Promise<ReadonlySet<string>> }
interface PasswordPolicy { validate(password: string): void }
// crypto and tokens
interface PasswordVerifier { verify(cred: StoredCredential, presented: string): Promise<{ ok: boolean; rehash?: string }>; hash(password: string): Promise<string> }
const ARGON2_OPTIONS: Readonly<{ type: 'argon2id'; memoryCost: 19456; timeCost: 2; parallelism: 1 }>;
function createPasswordVerifier(opts?: { bcrypt?: boolean }): PasswordVerifier;   // bcrypt off by default
interface TokenService { issueAccess(sub: string): { accessToken: string; expiresIn: number } }
function createTokenService(cfg: TokenConfig): TokenService;                       // pinned iss/aud/kid, alg HS256, { sub, typ: 'access' } only
class AuthService { /* login / refresh / logout; login returns tokens plus the resolved scope */ }
interface ResetLinkSink { send(input: { email: string; token: string }): Promise<void> }
// guards and decorators — route metadata lives here; forRoot registers the guards
const PUBLIC_KEY, AUTHENTICATED_KEY, PERMISSION_KEY: string;
function Public(): MethodDecorator & ClassDecorator;
function Authenticated(): MethodDecorator & ClassDecorator;
function RequirePermission(id: string): MethodDecorator & ClassDecorator;
function createJwtStrategy(opts: JwtStrategyOptions): Type<unknown>;               // alg/iss/aud required
class JwtAuthGuard implements CanActivate {}
class ScopeGuard implements CanActivate {}                                         // uses ScopeResolver<TScope>
class PermissionGuard implements CanActivate {}                                    // uses PermissionCatalogue; default deny
function assertEveryRouteGuarded(app: INestApplication): void;                     // reflection guard for the consumer's test
// module, SQL and codes
class AuthCoreModule { static forRoot(opts: AuthCoreOptions): DynamicModule }       // provides services, strategy and guards
function emitAuthSql(opts: { destDir: string; utc14: string }): Promise<readonly string[]>;
const AUTH_ERROR_CODES: { readonly [k: string]: string };                           // includes AUTH_REAUTH_FAILED
```

**Ownership fence.** Decorators and metadata keys live here, because the guards read them. The
consumer owns its controllers, its routes, its cookie/origin policy, its error codes, its envelope
serializer, its `AuthStore`/`ScopeResolver`/`PermissionCatalogue` adapters and its seed.
## 3. Commands

```sh
pnpm install
pnpm exec nx run-many -t lint typecheck test build      # all four packages
pnpm exec nx test auth-core                             # one package
node scripts/pack-smoke.mjs                             # import and require each packed tarball
pnpm exec changeset                                     # author a changeset
pnpm exec changeset version                             # apply bumps and changelogs
pnpm exec changeset publish --tag latest                # publish to public npm
```
## 4. Project structure

```
package.json  pnpm-workspace.yaml  nx.json  tsconfig.base.json  eslint.config.mjs  .npmrc
.changeset/                  changesets config and pending changeset files
packages/{config,logging,errors,auth-core}/   one package per folder, @naulabs/<name>
packages/auth-core/  src/{index.ts,module.ts,errors.ts,config.ts}  src/{ports,crypto,tokens,guards}/
                      sql/  versioned reference SQL — never executed here
                      bin/emit-auth-sql.mjs   copies sql/* into a consumer migration directory
.github/workflows/{ci,release}.yml     docs/spec.md  README.md  CLAUDE.md  AGENTS.md  LICENSE
```

Layering is enforced by folder-scoped ESLint: `ports/**` imports no Nest and no driver; a deep import
outside a package's `src/index.ts` fails.
## 5. Code style

Public surface is a contract; deep imports are a review failure. No consumer nouns in an export —
`subject`, `scope`, `role`, `permission` are the vocabulary — and named errors, one per failure mode, no
bare `new Error(...)`. Fail closed: a missing config key fails boot, an unannotated route is denied, an
unknown scheme is refused, a reused refresh token revokes the family. Prefer a dependency over a
hand-rolled abstraction; a new abstraction states why it could not be one. Comments explain why, never
what.
## 6. Testing strategy

- **Unit** (nothing): env parse/fail-boot; redaction; envelope serialization; `fromDomain`; guard order;
  `@Public`; default-deny; `{ sub, typ }`-only token; alg/iss/aud rejection; argon2id round-trip; bcrypt
  refusal when off; refresh reuse inside/outside grace; reset single-use.
- **Contract** (nothing): the `import`, `require` and `source` conditions resolve for every package; only
  `src/index.ts` is public; the ESM and CJS builds expose the same surface.
- **Integration** (its own container): the reference SQL applies cleanly to a throwaway `postgres:17`;
  `emitAuthSql` writes the expected files.
- **Consumer smoke** (its own container): a fixture app `require()`s and `import`s each packed tarball
  and boots; the matrix pins the consumer majors.

**Real Postgres, never a mocked driver** — for the SQL-apply test only; the package never runs
migrations, it proves its SQL parses and applies.
## 7. Boundaries

**Always** — pin `algorithms`, `issuer`, `audience`, `ignoreExpiration` as required strategy options;
argon2id for passwords, SHA-256 for ≥256-bit secrets, timing-safe compares; ship authentication tables as
versioned SQL plus an emit helper, with the consumer owning the migration; semver + changesets with exact
pins; take the consumer seams (`AuthStore`, `ScopeResolver`, `PermissionCatalogue`, the code map, the
envelope serializer, `Clock`, `PasswordPolicy`) as inputs.
**Ask first** — a fifth package; a breaking export or major bump; enabling bcrypt by default; any change
the security review flags.
**Never** — compile consumer specifics into a package (the scope model, roles/permissions, claims beyond
`{ sub, typ }`, error codes, envelope shape, mailer/storage/outbox/rate-limit/metrics); a package that
runs a migration or connects with an elevated role; a second password scheme on by default; a JWT reset
token; a scope claim in a token; logging a credential, a token, a raw SQL parameter or a reset token; a
deep import path.
## 8. Versioning, release and smoke

The four packages share one version (one changesets `fixed` group) so a partial upgrade cannot happen;
consumers pin exact versions. `main` is protected and only takes pull requests: with pending changesets
the release workflow opens and updates a `chore(release): version packages` pull request from
`changeset-release/main`, and no version commit is pushed to `main`. Merging that pull request leaves no
pending changesets, so the publish job builds and publishes the four packages with `changeset publish`
to public npm with provenance. Publishing targets public npm; the `@naulabs` npm organisation, an
`NPM_TOKEN` repository secret and a fine-grained `RELEASE_TOKEN` (contents + pull-requests write, so CI
runs on the release pull request) are human-owned prerequisites for the first publish; Actions must
also be allowed to create pull requests at organisation and repository level. CI packs the four
packages and installs the tarballs into a small fixture app that boots, so a missing `dist` file, a
missing export condition or a stripped import fails CI rather than a consumer.
## 9. Success criteria

- `pnpm exec nx run-many -t lint typecheck test build` is green; `pack-smoke` is green.
- A consumer builds and boots against the pinned published versions; installing a package is the only
  integration step.
- A grep for a consumer product or domain noun across every public export is empty.
- `emitAuthSql` writes `<utc14>_<name>.sql` into a consumer directory and refuses to overwrite.
- `auth-core` passes the security review before any publish.
## 10. Decisions (resolved)

- **Tooling/format:** pnpm + Nx; dual ESM + CJS (`import` + `require` + `@naulabs/source` conditions);
  declaration files and source maps emitted. Public MIT, scope `@naulabs`, repo
  `naulabsdotco/nest-platform`.
- **Reference SQL:** ships `subject`, `subject_credential`, `refresh_token`, `password_reset_token`,
  `login_attempt` only (a scope/membership table does not ship here); `email` is `citext`; `login_attempt`
  is not partitioned.
- **Codes:** scope selection is `AUTH_SCOPE_SELECTION_REQUIRED` (400); re-auth is `AUTH_REAUTH_FAILED`;
  no vendor-style naming anywhere.
- **Guards:** `forRoot` registers them as global guards, ordered `JwtAuth → Scope → Permission`.
- **Tests:** Vitest; SQL-apply uses testcontainers; `login` returns tokens plus the resolved scope; the
  consumer contract stays in-repo. A human creates the `@naulabs` npm org and sets `NPM_TOKEN` before
  the first publish.
