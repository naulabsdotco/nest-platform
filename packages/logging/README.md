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

## Context fields on message lines

With `microservice` on, the same `contextFields` are read once from the message data
(`context.switchToRpc().getData()`) and bound to every line of that message, handler and
closing alike:

```ts
createLoggerModule({ service: 'example-app', microservice: true, contextFields: ['tenantId'] });
```

```ts
@MessagePattern('example.run')
run(@Payload() data: { tenantId: string }) {
  this.logger.info({ event: 'example.run' }, 'handled');
}
```

The data must be an object; `null`, an array or a primitive adds no field and does not
throw. A field the handler discovers later still arrives through `PinoLogger.assign`, and the
reserved-name rule in `## Context fields` holds on message lines too. Two messages in flight
keep their own values.

## Message correlation id

By default the seam reads the id from the transport metadata and generates one when it is absent,
as described under `### Microservice transports`. When the id arrives somewhere the seam does not
read, or a transport has no headers at all, supply it from the message context:

```ts
import { Ctx, MessagePattern } from '@nestjs/microservices';
import type { ExecutionContext } from '@nestjs/common';

createLoggerModule({
  service: 'example-app',
  microservice: { genReqId: (context) => readMessageId(context) },
});

@MessagePattern('example.run')
run(@Ctx() context: ExecutionContext) {
  this.logger.info({ event: 'example.run' }, 'handled');
}
```

`readMessageId` reads the app's own transport metadata. It runs once per message. Its return must
be a canonical UUID — a string, `Buffer` or one-element array — which is accepted and folded to
lowercase; anything else becomes a generated UUID, so an untrusted value is never logged. A throw
falls back to the transport metadata, so logging never fails a message. `microservice: {}` enables
the seam like `microservice: true`. The accepted id is on every line, the closing line included.

A handler reads the id in use with `currentCorrelationId`, passing its injected `PinoLogger`:

```ts
import { currentCorrelationId } from '@naulabsco/logging';

@MessagePattern('example.run')
run() {
  const correlationId = currentCorrelationId(this.logger);
  this.logger.info({ event: 'example.run', correlationId }, 'handled');
}
```

It returns the id bound to the current message — the same value carried by every line of that
message, the closing line included — and `undefined` outside a bound message context. An optional
second argument names a different binding key.

## The field contract

Every line carries the reserved fields in `LOG_FIELDS`:

```ts
const LOG_FIELDS = ['event', 'correlationId', 'outcome'] as const;
```

These names are the contract and are not renamed. On handler lines `event` and `outcome` come
from the call site; `correlationId` comes from the middleware, or from the message seam. On the
automatic request and message lines `event` comes from `autoEvents`.

## Automatic line events

The automatic line pino-http and the message seam write at the end of a request or message carries no `event` by default. Name it with `autoEvents`:

```ts
createLoggerModule({
  service: 'example-app',
  autoEvents: { request: 'http.request', message: 'message.received' },
});
```

`request` names the `event` on the automatic HTTP request-completion line, on both success and
error; `message` names it on the automatic microservice completion line, on both completed and
errored. Each name must be a non-empty string after trimming, or `createLoggerModule` throws a
`TypeError` naming the option. `msg` and handler lines are unchanged: a handler keeps its own
`{ event }` and message text; an `assign`ed `event` wins on the automatic line too.

## Context fields

A consumer adds its own neutral fields through `contextFields`. On HTTP each named field
is read off the request when it enters, so set it in an earlier middleware:

```ts
app.use(setTenantContext);
// ...
createLoggerModule({ service: 'example-app', contextFields: ['tenantId', 'role'] });
```

A field name is ignored when it is reserved: the `LOG_FIELDS`, pino's automatic keys
(`level`, `time`, `msg`, `pid`, `hostname`, `v`), pino-http's (`req`, `res`, `err`,
`responseTime`), or the module's (`service`, `durationMs`, `rpc`). This applies to HTTP too,
so a 0.3.0 consumer that listed one of those names now gets no binding rather than a
clobbered automatic field. A value discovered later — in a guard, say — is bound at log time
with `PinoLogger.assign`.

## Redaction

`DEFAULT_REDACT_PATHS` redacts the `authorization` header, credential bodies and SQL
parameters. `redactExtra` appends to it:

```ts
createLoggerModule({ service: 'example-app', redactExtra: ['subjectEmail'] });
```

The defaults can never be emptied, only extended.
