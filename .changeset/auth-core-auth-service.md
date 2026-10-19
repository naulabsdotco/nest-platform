---
"@naulabs/auth-core": minor
---

Add `AuthService`: login verifies the credential, runs a dummy verify for an unknown email, returns the access token, refresh token and resolved scope, and records every attempt with a hashed email; refresh and logout delegate to `RefreshService`.
