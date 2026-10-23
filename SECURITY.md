# Security policy

## Reporting a vulnerability

Do not open a public issue. Use GitHub's private vulnerability reporting on this repository
(**Security → Report a vulnerability**). Include the affected package and version, the impact, and the
smallest reproduction you can share. You will get an acknowledgement within seven days.

Only the latest published minor of each package is supported. A fix ships as a patch release to that
minor; older minors are not patched.

## Release gate

`@naulabs/auth-core` is a shared authentication library and a single point of failure. It publishes
only after the review in [`docs/auth-core-security-review.md`](docs/auth-core-security-review.md) is
signed. The release workflow fails before the publish step when the signer or date field is empty or
when a review row names a test that no longer exists.

Publishing is also human-owned: the `@naulabs` npm organisation must exist, the `NPM_TOKEN` repository
secret must be set, and GitHub Actions must be enabled. Until then the release workflow is green and
skips the publish step.

## Scope

This repository ships mechanism only: no credentials, tokens or consumer data. Report a flaw in the
mechanism (a guard bypass, a token-reuse gap, a redaction miss, an injection path) rather than in a
consumer's adapter. A vulnerability in a consumer's `AuthStore`, `ScopeResolver` or
`PermissionCatalogue` belongs to that consumer.
