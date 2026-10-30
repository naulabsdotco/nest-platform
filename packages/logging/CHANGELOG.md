# @naulabsco/logging

## 0.2.0

### Minor Changes

- e9b2c83: `createLoggerModule({ microservice: true })` logs non-HTTP message handlers through the `nestjs-pino` message seam: the inbound id is read from the transport's metadata (a Kafka message's `headers`, a NATS `getHeaders()` map, or AMQP's `properties.headers`), matched case-insensitively, accepted only when it is a canonical UUID and generated otherwise, and every line of the message carries it as `correlationId`. A handler binds a per-message context field once with `PinoLogger.assign`, and the seam logs `durationMs` on the line that closes the message. `destination` sends the lines to a stream other than stdout. The `@nestjs/common` peer floor moves to `^12.0.2` and `nestjs-pino` to `^5.2.0`: earlier 12.0.x releases corrupt a handler's return value once a pre-request hook is present, and 5.0/5.1 have no message seam.

## 0.1.0

### Minor Changes

- 7230612: Correlate and redact: a pino logger module that binds one `correlationId` per request
  and ships a default redaction list a consumer can extend but never empty.
- 8e218f3: Publish the leaf packages `0.1.0` with npm provenance from a release workflow that packs every package
  and fails before publishing when a `dist` artifact is missing.

### Patch Changes

- 494ebe1: Accept only a canonical UUID as an inbound correlation id; any other value is replaced with a fresh UUID.
