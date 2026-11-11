---
'@naulabsco/logging': minor
---

`contextFields` now applies to microservice message lines, read once from the message data and
bound to every line of that message. A context field that collides with a reserved, automatic,
base or module name is now ignored on HTTP too, a behaviour change for a consumer that listed
such a name.
