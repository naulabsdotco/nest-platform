---
'@naulabsco/logging': minor
---

`microservice` accepts `MicroserviceLoggerOptions.genReqId(context)`; a canonical UUID return is
accepted and lowercased, anything else falls back to a generated UUID, a throw falls back to the
default resolver, and `microservice: {}` enables the seam like `true`.
