# @naulabs/logging

pino logger module with a correlation id and a redaction list a consumer can
extend but not empty.

## Install

```sh
pnpm add @naulabs/logging
```

## Usage

```ts
import { createLoggerModule, correlationMiddleware } from '@naulabs/logging';

@Module({
  imports: [createLoggerModule({ service: 'example-app', contextFields: ['tenantId'] })],
})
class ExampleModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(correlationMiddleware()).forRoutes('{*splat}');
  }
}
```

`createLoggerModule` provides the pino logger through DI; `nestjs-pino` exposes a
request-scoped child whose every line carries `correlationId`. `correlationMiddleware`
reads the inbound `x-correlation-id` (or generates one) and echoes it on the response.

## The field contract

Every line carries the reserved fields in `LOG_FIELDS`:

```ts
const LOG_FIELDS = ['event', 'correlationId', 'outcome'] as const;
```

These names are the contract and are not renamed. `event` and `outcome` come from the
call site; `correlationId` comes from the middleware.

## Context fields

A consumer adds its own neutral fields through `contextFields`. Each named field is read
off the request when it enters, so set it in an earlier middleware:

```ts
app.use(setTenantContext);
// ...
createLoggerModule({ service: 'example-app', contextFields: ['tenantId', 'role'] });
```

A value discovered later — in a guard, say — is bound at log time with `PinoLogger.assign`
instead. `contextFields` may not shadow a reserved name; a collision is ignored.

## Redaction

`DEFAULT_REDACT_PATHS` redacts the `authorization` header, credential bodies and SQL
parameters. `redactExtra` appends to it:

```ts
createLoggerModule({ service: 'example-app', redactExtra: ['subjectEmail'] });
```

The defaults can never be emptied, only extended.
