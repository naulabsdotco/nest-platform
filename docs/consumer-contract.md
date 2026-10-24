# Consumer contract

The public surface of the published packages; only the package root is public, anything else may change
in a patch. Each ships dual ESM + CJS (`import`, `require`, `@naulabsco/source`), so both resolve the same
surface. Pin exact versions.

## `@naulabsco/config`

```ts
type EnvReader = Record<string, string | undefined>;
class ConfigValidationError extends Error { readonly code = 'CONFIG_INVALID'; readonly missing: readonly string[] }
function loadEnv<T>(schema: z.ZodType<T>, raw?: EnvReader): T;
const APP_CONFIG: InjectionToken<unknown>;
function createConfigModule<T>(schema: z.ZodType<T>, opts?: { raw?: EnvReader }): DynamicModule;
```

The schema is the consumer's; the package owns parse, fail-at-boot and the token. A failure names the
missing keys and never echoes their values. `zod` is a peer dependency.

## `@naulabsco/logging`

```ts
const CORRELATION_HEADER = 'x-correlation-id';
const DEFAULT_REDACT_PATHS: readonly string[];
const LOG_FIELDS: readonly ['event', 'correlationId', 'outcome'];
interface LoggerOptions { service: string; level?: string; correlationHeader?: string; redactExtra?: readonly string[]; contextFields?: readonly string[] }
function createLoggerModule(opts: LoggerOptions): DynamicModule;
function correlationMiddleware(opts?: { header?: string }): RequestHandler;
```

Field names are the contract. A consumer adds context fields and redactions; it cannot remove a
default redaction path. `pino` and `nestjs-pino` are peer dependencies.

## `@naulabsco/errors`

```ts
abstract class DomainError extends Error { abstract readonly code: string; readonly criteria?: unknown }
abstract class ApplicationError extends Error {
  readonly statusCode: number; readonly code: string; readonly criteria?: unknown;
  static fromDomain(e: unknown): ApplicationError;
}
class InfrastructureError extends ApplicationError {} // 500; detail never serialized
class NotFoundError extends ApplicationError {}       // 404
class ConflictError extends ApplicationError {}       // 409
class ValidationError extends ApplicationError {}     // 400
class UnauthorizedError extends ApplicationError {}   // 401
class ForbiddenError extends ApplicationError {}      // 403
interface ErrorRequest { readonly method: string; readonly path: string }
interface EnvelopeSerializer { serialize(error: ApplicationError, req: ErrorRequest, timestamp: string): unknown }
function defaultEnvelopeSerializer(): EnvelopeSerializer;
class HttpExceptionFilter implements ExceptionFilter { constructor(serializer: EnvelopeSerializer) }
function createExceptionFilter(serializer: EnvelopeSerializer): Type<ExceptionFilter>;
```

The envelope shape is the consumer's. The filter maps `ApplicationError` to its status/code/criteria,
`ZodError` to 400, and anything else to a 500 `INTERNAL_ERROR` with no detail. `@nestjs/common` is a
peer dependency.

## `@naulabsco/auth-core`

```ts
class AuthCoreModule { static forRoot(opts: AuthCoreOptions): DynamicModule }
class AuthService { /* login / refresh / logout; login returns tokens plus the resolved scope */ }
const PUBLIC_KEY, AUTHENTICATED_KEY, PERMISSION_KEY: string;
function Public(): MethodDecorator & ClassDecorator;
function Authenticated(): MethodDecorator & ClassDecorator;
function RequirePermission(id: string): MethodDecorator & ClassDecorator;
function createJwtStrategy(opts: JwtStrategyOptions): Type<unknown>;
class JwtAuthGuard implements CanActivate {}
class ScopeGuard implements CanActivate {}
class PermissionGuard implements CanActivate {}
function assertEveryRouteGuarded(app: INestApplication): void;
function createPasswordVerifier(opts?: { bcrypt?: boolean }): PasswordVerifier;
function createTokenService(cfg: TokenConfig): TokenService;
function emitAuthSql(opts: { destDir: string; utc14: string } & AuthSqlShape & { direction?: 'up' | 'down' | 'both'; verify?: boolean; mode?: 'write' }): Promise<readonly string[]>;
function emitAuthSql(opts: { destDir: string; utc14: string; mode: 'check' } & AuthSqlShape & { direction?: 'up' | 'down' | 'both'; verify?: boolean }): Promise<readonly { path: string; status: 'missing' | 'differs' | 'in-sync' }[]>;
interface AuthSqlShape {
  tables?: { subject?: string; credential?: string; refreshToken?: string; resetToken?: string; loginAttempt?: string };
  columns?: { credential?: { sourceUpdatedAt?: boolean; failedCount?: boolean; lockedUntil?: boolean } };
  loginAttempt?: { partitioned?: { by: 'range'; column: string } };
}
const AUTH_ERROR_CODES: { readonly [k: string]: string };
```

`forRoot` requires every seam below, provides the services, the strategy and the three guards, and
registers the guards globally in the fixed order `JwtAuth → Scope → Permission`. `guardPipeline` may
add consumer guards at `afterAuth` (after the JWT guard, before the scope guard) and `afterScope`
(after the scope guard, before the permission guard); no other slot exists. Each entry is a guard class
(dependency-free, resolved in auth-core's injector) or a guard instance for one that needs a consumer
provider; `@Public` routes run them without a principal or scope. The scope model, the
error-code map, the envelope and the seed stay with the consumer.

### Ports a consumer implements

| Port | Contract |
| --- | --- |
| `AuthStore` | credentials by email, scopes by email, credential-hash replacement, refresh and reset rows, login-attempt audit |
| `ScopeResolver<TScope extends AuthScope>` | `resolve(sub): Promise<TScope \| null>` |
| `PermissionCatalogue` | `grantsFor(scope, role): Promise<ReadonlySet<string>>` |
| `PasswordPolicy` | `validate(password): void \| Promise<void>` |
| `Clock` | `now(): Date`, so expiry and reuse grace are testable |
| `ResetLinkSink` | `send({ email, token }): Promise<void>` — the consumer delivers the link |

`AuthScope` is `{ subject, scope, role, active }`; the meaning of `scope` and `role` is the consumer's.
`AuthStore.markRefreshUsed` must compare-and-set on `used_at IS NULL AND revoked_at IS NULL`. The
reference SQL is emitted with `emitAuthSql`; the consumer owns its forward migration, rollback and
verification.

`auth-core` publishes only past the signed review in
[`docs/auth-core-security-review.md`](auth-core-security-review.md). It depends on `@naulabsco/errors`;
install both.

## Installing

`pnpm add @naulabsco/config @naulabsco/logging @naulabsco/errors @naulabsco/auth-core`. Publishing runs only
from `main`, with npm provenance through trusted publishing (GitHub OIDC); the `@naulabsco` npm
organisation and a trusted publisher for each package are human-owned prerequisites — see
[`SECURITY.md`](../SECURITY.md).
