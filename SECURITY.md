# Security policy

## Reporting a vulnerability

Do not open a public issue. Use GitHub's private vulnerability reporting on this repository
(**Security → Report a vulnerability**) with the affected package and version, the impact, and the
smallest reproduction. You will get an acknowledgement within seven days.

Only the latest published minor of each package is supported; a fix ships as a patch to that minor.

## Release gate

`@naulabsco/auth-core` is a shared authentication library and a single point of failure. It publishes
only after the review in [`docs/auth-core-security-review.md`](docs/auth-core-security-review.md) is
signed. The release workflow fails before the publish step when the signer or date field is empty or
when a review row names a test that no longer exists.

Publishing is also human-owned: the `@naulabsco` npm organisation must exist, each package needs a
trusted publisher for this repository's `release.yml` workflow in the `npm-publish` environment (no npm
token is stored), and the release pull request must be opened with a fine-grained `RELEASE_TOKEN`
(contents + pull-requests write) so CI runs on it. GitHub Actions must be enabled and allowed to create
pull requests. Until trusted publishers are configured the publish job fails before building.

The `publish` job runs in the `npm-publish` GitHub environment. Configure that environment with
required reviewers so a human approves each deployment; the signer check runs before the approval, so
an agent-signed record alone cannot publish.

This repository ships mechanism only: no credentials, tokens or consumer data. Report a flaw in the
mechanism, not in a consumer's `AuthStore`, `ScopeResolver` or `PermissionCatalogue`.
