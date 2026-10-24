---
'@naulabsco/auth-core': minor
---

Let `emitAuthSql` take an optional shape: renamed tables (with their foreign keys and index names following), removed optional credential columns, and a partitioned login-attempt table. Omitted options keep the reference output byte-for-byte, and the bin reads the same object from `--config`.
