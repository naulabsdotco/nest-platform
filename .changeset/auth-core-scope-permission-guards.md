---
"@naulabs/auth-core": minor
---

Add `ScopeGuard` and `PermissionGuard`: the resolved scope is written to the request, an inactive scope is refused with 403, and a route that names none of the three keys fails closed with `MissingRouteGuardError`.
