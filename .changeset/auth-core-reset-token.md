---
"@naulabs/auth-core": minor
---

Add `ResetService` and `ResetLinkSink`: a reset token is 32 random bytes stored as SHA-256 hex, the password policy runs before any state change, a consume is single-use, and a successful reset revokes every refresh family for the subject.
