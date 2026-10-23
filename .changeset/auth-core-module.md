---
"@naulabs/auth-core": minor
---

Add `AuthCoreModule.forRoot`, which takes every consumer seam, refuses to boot without one, provides the token service, password verifier, refresh, reset and auth services, registers the JWT strategy and the three guards globally in order, and binds an overridable error-code map.
