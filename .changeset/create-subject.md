---
'@naulabsco/auth-core': minor
---

Add an optional `AuthStore.createSubject({ email, credential, scopes })`: when an adapter implements it, one call writes the subject, its credential and every scope row in one transaction, with `active` defaulting to true. A duplicate email or an unknown scope surfaces as one `AuthSubjectCreationFailedError` (409), no plaintext password reaches the port, and existing adapters compile unchanged because the member is optional.
