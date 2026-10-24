---
'@naulabsco/auth-core': patch
---

Document the `PasswordPolicy` rejection convention: throw `AuthPasswordPolicyError` with `{ problems: [{ rule, detail? }] }`. The code is `AUTH_PASSWORD_POLICY`, the status map gives 422, `fromDomain` keeps the list, and the policy runs before any state change. No runtime surface changes.
