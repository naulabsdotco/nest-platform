---
'@naulabsco/errors': minor
---

Accept an optional developer-facing message after a `DomainError`'s criteria and carry it through
`ApplicationError.fromDomain` at a mapped status, so `defaultEnvelopeSerializer` returns it in the
response body. A subclass message that a 4xx body previously dropped now appears; criteria-only
construction is unchanged, and an unmapped code still fails closed to a 500 `INTERNAL_ERROR` with no
message or criteria.
