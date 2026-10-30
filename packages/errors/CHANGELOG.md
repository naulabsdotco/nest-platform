# @naulabsco/errors

## 0.2.0

### Minor Changes

- 8485dee: Add framework-free `./domain` and `./application` entry points. `./domain` re-exports `DomainError`;
  `./application` re-exports the rest of the taxonomy (`ApplicationError` with `fromDomain`, the kinds)
  and the envelope serializer. Neither loads `@nestjs/common`, while the root entry keeps the Nest HTTP
  filter and its current surface.

## 0.1.0

### Minor Changes

- ba2f0ad: Map domain error codes to HTTP statuses in `fromDomain`, and accept the map in the exception filter.
- 2f60ede: Add the domain and application error taxonomy with `fromDomain`, and a pluggable-envelope HTTP filter.
- 8e218f3: Publish the leaf packages `0.1.0` with npm provenance from a release workflow that packs every package
  and fails before publishing when a `dist` artifact is missing.
