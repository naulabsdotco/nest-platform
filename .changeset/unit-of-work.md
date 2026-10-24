---
'@naulabsco/auth-core': minor
---

Add an optional `UnitOfWork` seam: `resetPassword` runs the consume, the hash replacement and the refresh revocation in one transaction when one is injected, and `consumeResetToken` now spends every live reset link for the subject. `AuthStore` methods take the transaction as an optional trailing argument; without a `UnitOfWork` the sequential path is unchanged.
