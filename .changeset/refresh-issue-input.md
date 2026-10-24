---
'@naulabsco/auth-core': minor
---

Carry request metadata through `RefreshService.issue`: it now takes `{ subjectId, scope?, userAgent?, ip?, familyId? }` (a plain subject id still works), `login` forwards the resolved scope plus the user agent and ip, a supplied `familyId` is reused, and rotation continues the family and its scope. The user agent is capped at 512 characters, a malformed ip is dropped, the reference refresh table gains a nullable `scope` column, and `RefreshRecord` exposes the optional `scope`.
