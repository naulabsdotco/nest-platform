---
'@naulabsco/auth-core': minor
---

Add `check`, `down` and `verify` modes to `emitAuthSql`: check reports `missing`, `differs` or `in-sync` per file without writing, down emits `DROP TABLE IF EXISTS` files in reverse foreign-key order, and verify emits schema assertions to apply after the up set. `--check` exits 1 on any difference.
