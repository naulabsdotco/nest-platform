---
"@naulabs/auth-core": minor
---

Add an HS256 access-token service whose payload is `{ sub, typ: 'access' }` only, pinned to the active kid, issuer and audience.
