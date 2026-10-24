---
'@naulabsco/auth-core': minor
---

Add `guardPipeline` to `AuthCoreModule.forRoot`: a consumer guard can run after the JWT guard and before the scope guard (`afterAuth`) or after the scope guard and before the permission guard (`afterScope`). Binding stays global and the built-in relative order cannot change; an unknown slot fails boot.
