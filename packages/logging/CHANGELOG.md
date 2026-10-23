# @naulabsco/logging

## 0.1.0

### Minor Changes

- 7230612: Correlate and redact: a pino logger module that binds one `correlationId` per request
  and ships a default redaction list a consumer can extend but never empty.
- 8e218f3: Publish the leaf packages `0.1.0` with npm provenance from a release workflow that packs every package
  and fails before publishing when a `dist` artifact is missing.

### Patch Changes

- 494ebe1: Accept only a canonical UUID as an inbound correlation id; any other value is replaced with a fresh UUID.
