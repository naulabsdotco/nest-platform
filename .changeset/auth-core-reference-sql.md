---
"@naulabs/auth-core": minor
---

Add the versioned reference SQL (subject, credential, refresh, reset and login-attempt tables, hashed only) and `emitAuthSql`, which writes `<utc14>_<name>.sql` into a consumer's migration directory and refuses to overwrite.
