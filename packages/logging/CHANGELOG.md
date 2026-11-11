# @naulabsco/logging

## 0.4.0

### Minor Changes

- 743c18d: `LoggerOptions` gains `autoEvents`. `request` names the `event` on the automatic HTTP
  request-completion line and `message` names it on the automatic microservice completion
  line. Each name must be a non-empty string. Handler lines, `msg` and the output without the
  option are unchanged.
- fbd51bd: New `currentCorrelationId(logger, key?)` reads the id bound to the current message, so a handler
  gets the same value carried by every line without re-deriving it; outside a bound message context,
  or when the binding is not a string, it returns `undefined`.
- 4b4c590: `LoggerOptions` gains `customAttributeKeys`, which accepts only `{ responseTime?: string }` and
  renames the automatic HTTP line's duration key. The default stays `responseTime`, and the
  microservice completion line keeps `durationMs`. Renaming `req`, `res` or `err` would bypass
  redaction, so those keys are rejected, as is any reserved target other than `responseTime` and
  `durationMs`. The option is structural, so no new peer dependency is added.
- 5fa55a4: `contextFields` now applies to microservice message lines, read once from the message data and
  bound to every line of that message. A context field that collides with a reserved, automatic,
  base or module name is now ignored on HTTP too, a behaviour change for a consumer that listed
  such a name.
- 45c1f05: `microservice` accepts `MicroserviceLoggerOptions.genReqId(context)`; a canonical UUID return is
  accepted and lowercased, anything else falls back to a generated UUID, a throw falls back to the
  default resolver, and `microservice: {}` enables the seam like `true`.

## 0.3.0

No changes in this release.

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
