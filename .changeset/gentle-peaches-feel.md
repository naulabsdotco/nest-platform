---
'@naulabsco/errors': minor
---

Add framework-free `./domain` and `./application` entry points. `./domain` re-exports `DomainError`;
`./application` re-exports the rest of the taxonomy (`ApplicationError` with `fromDomain`, the kinds)
and the envelope serializer. Neither loads `@nestjs/common`, while the root entry keeps the Nest HTTP
filter and its current surface.
