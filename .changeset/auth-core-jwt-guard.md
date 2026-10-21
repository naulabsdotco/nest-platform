---
"@naulabs/auth-core": minor
---

Add `createJwtStrategy` and `JwtAuthGuard`: the pinned `algorithms`, `issuer` and `audience` are required options, `validate` returns `{ sub }` only, and every failure is one `AuthInvalidTokenError`.
