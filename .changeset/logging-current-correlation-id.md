---
'@naulabsco/logging': minor
---

New `currentCorrelationId(logger, key?)` reads the id bound to the current message, so a handler
gets the same value carried by every line without re-deriving it; outside a bound message context,
or when the binding is not a string, it returns `undefined`.
