---
'@naulabsco/logging': minor
---

`LoggerOptions` gains `customAttributeKeys`, which accepts only `{ responseTime?: string }` and
renames the automatic HTTP line's duration key. The default stays `responseTime`, and the
microservice completion line keeps `durationMs`. Renaming `req`, `res` or `err` would bypass
redaction, so those keys are rejected, as is any reserved target other than `responseTime` and
`durationMs`. The option is structural, so no new peer dependency is added.
