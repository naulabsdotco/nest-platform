---
'@naulabsco/auth-core': minor
---

Allow deferred adapter seams in `forRoot`: naming a missing seam in `deferredSeams` boots with a proxy that throws `AuthConfigError({ missing })` on first use, while `tokenConfig` and the lifetimes stay required. `AuthCoreModule.assertSeamsReady(app)` lists every seam still deferred, and a provided adapter wins over its deferral.
