---
'@naulabsco/auth-core': minor
---

Allow deferred adapter seams in `forRoot`: naming a missing seam in `deferredSeams` makes exactly that seam optional in the options type and boots with a proxy that throws `AuthConfigError({ missing })` on first use, while `tokenConfig` and the lifetimes stay required. `AuthCoreModule.assertSeamsReady(app)` lists every seam still deferred, a provided adapter wins over its deferral, and a deferred reset sink fails loudly instead of being swallowed as a delivery error.
