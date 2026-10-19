---
"@naulabs/auth-core": minor
---

Add `RefreshService`: refresh tokens are 32 random bytes stored as SHA-256 hex, a valid token rotates within its family, and reuse outside the grace revokes the whole family with `AuthRefreshReuseDetectedError`.
