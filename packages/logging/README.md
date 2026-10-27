# @naulabsco/logging

pino logger module with a correlation id for HTTP requests and non-HTTP
messages, and a redaction list a consumer can extend but not empty.

## Install

```sh
pnpm add @naulabsco/logging
```

## Usage

```ts
import { createLoggerModule, correlationMiddleware } from '@naulabsco/logging';

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
reads the inbound `x-correlation-id`, accepting it only when it is a canonical UUID
(case-insensitive, pinned to lowercase); any other value is replaced with a fresh UUID,
and the accepted or generated id is echoed on the response header.

The lines go to stdout. Pass `destination` to send them to another pino stream:

```ts
import pino from 'pino';

createLoggerModule({ service: 'example-app', destination: pino.destination(2) });
```

### Microservice transports

`correlationMiddleware` is HTTP-only. A microservice consumer turns on the message seam
instead, and keeps the HTTP wiring when the app serves both:

```ts
import { Controller, Module } from '@nestjs/common';
import { MessagePattern } from '@nestjs/microservices';
import { createLoggerModule } from '@naulabsco/logging';
import { PinoLogger } from 'nestjs-pino';

@Module({ imports: [createLoggerModule({ service: 'example-app', microservice: true })] })
class ExampleModule {}

@Controller()
class ExampleController {
  constructor(private readonly logger: PinoLogger) {}

  @MessagePattern('example.run')
  run() {
    this.logger.assign({ tenantId: 'acme' });
    this.logger.info({ event: 'example.run', outcome: 'success' }, 'handled');
  }
}
```

A hybrid app has to hand the microservice the application's config, or the hook never
reaches it:

```ts
const app = await NestFactory.create(ExampleModule);
app.connectMicroservice(microserviceOptions, { inheritAppConfig: true });
await app.startAllMicroservices();
await app.listen(3000);
```

The seam reads the inbound id from the transport's metadata — a Kafka message's `headers`, a
NATS message's `getHeaders()`, or AMQP's `properties.headers` — matching the header in any
case. It accepts it only when it is a canonical UUID, and generates one otherwise. Every line
of the message carries it as `correlationId`, and the line that closes the message carries
`durationMs`. A transport that exposes the id somewhere else (gRPC metadata, an MQTT packet)
or nowhere (TCP, Redis) gets a generated id.

`assign` binds a per-message field once; the lines that follow and the closing line carry
it. With the seam on, `assign` also reaches the line that closes an HTTP request
(`assignResponse`), so both transports share one field contract.

The seam needs NestJS 12.0.2 or later and `nestjs-pino` 5.2 or later, both peer ranges:
earlier 12.0.x releases mangled a handler's plain return value once a pre-request hook was
present, and 5.0/5.1 have no message seam at all.

## The field contract

Every line carries the reserved fields in `LOG_FIELDS`:

```ts
const LOG_FIELDS = ['event', 'correlationId', 'outcome'] as const;
```

These names are the contract and are not renamed. `event` and `outcome` come from the
call site; `correlationId` comes from the middleware, or from the message seam.

## Context fields

A consumer adds its own neutral fields through `contextFields`. On HTTP each named field
is read off the request when it enters, so set it in an earlier middleware:

```ts
app.use(setTenantContext);
// ...
createLoggerModule({ service: 'example-app', contextFields: ['tenantId', 'role'] });
```

A value discovered later — in a guard, say — is bound at log time with `PinoLogger.assign`
instead; a message handler has only `assign`. `contextFields` may not shadow a reserved
name; a collision is ignored.

## Redaction

`DEFAULT_REDACT_PATHS` redacts the `authorization` header, credential bodies and SQL
parameters. `redactExtra` appends to it:

```ts
createLoggerModule({ service: 'example-app', redactExtra: ['subjectEmail'] });
```

The defaults can never be emptied, only extended.
