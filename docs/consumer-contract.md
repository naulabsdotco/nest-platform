# Consumer contract

The public surface of the published packages. Only the package root is public; any other path may
change in a patch. Each package ships dual ESM + CJS — `exports` carries `import`, `require` and the
`@naulabs/source` dev condition, each with a `dist` fallback — so `import` and `require` resolve the
same surface. Pin exact versions.

## `@naulabs/config`

```ts
type EnvReader = Record<string, string | undefined>;
class ConfigValidationError extends Error {
  readonly code = 'CONFIG_INVALID';
  readonly missing: readonly string[];
}
function loadEnv<T>(schema: z.ZodType<T>, raw?: EnvReader): T;
const APP_CONFIG: InjectionToken<unknown>;
function createConfigModule<T>(schema: z.ZodType<T>, opts?: { raw?: EnvReader }): DynamicModule;
```

The schema is the consumer's; the package owns parse, fail-at-boot and the token. A failure names the
missing keys and never echoes their values. `zod` is a peer dependency.

## `@naulabs/logging`

```ts
const CORRELATION_HEADER = 'x-correlation-id';
const DEFAULT_REDACT_PATHS: readonly string[];
const LOG_FIELDS: readonly ['event', 'correlationId', 'outcome'];
interface LoggerOptions {
  service: string;
  level?: string;
  correlationHeader?: string;
  redactExtra?: readonly string[];
  contextFields?: readonly string[];
}
function createLoggerModule(opts: LoggerOptions): DynamicModule;
function correlationMiddleware(opts?: { header?: string }): RequestHandler;
```

Field names are the contract. A consumer adds context fields and redactions; it cannot remove a
default redaction path. `pino` and `nestjs-pino` are peer dependencies.

## `@naulabs/errors`

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

## Installing

```sh
pnpm add @naulabs/config @naulabs/logging @naulabs/errors
```

Publishing runs only from `main`, with npm provenance. The `@naulabs` npm organisation and the
`NPM_TOKEN` repository secret are human-owned prerequisites; see [`SECURITY.md`](../SECURITY.md).
