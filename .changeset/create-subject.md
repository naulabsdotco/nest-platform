---
'@naulabsco/auth-core': minor
---

Add `AuthStore.createSubject({ email, credential, scopes })`: one call writes the subject, its credential and every scope row in one transaction, with `active` defaulting to true. A duplicate email or an unknown scope surfaces as one `AuthSubjectCreationFailedError` (409), and no plaintext password reaches the port.
