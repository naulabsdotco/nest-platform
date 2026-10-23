# `@naulabs/auth-core` security review

Signer: opencode deepseek-v4.1-flash
Date: 2026-10-23
Scope: the `0.1.0` public surface of `@naulabs/auth-core`.

Each row names the test that proves it. `node scripts/security-review.mjs` fails when a row is
missing, when a named test no longer exists, or when `Signer` or `Date` is empty. The
`security-review` job in `.github/workflows/release.yml` runs it, and the `publish` job needs that job,
so an unsigned or stale review blocks the whole release.

This review was performed by the implementation agent. A human maintainer must review it and re-sign
by editing `Signer` and `Date` in a pull request before the first publish; the gate re-runs on that
pull request and on `main`.

| # | Property | Proving test |
| --- | --- | --- |
| 1 | The strategy pins `algorithms`, `issuer`, `audience` and `ignoreExpiration: false`; `alg:none` and HS/RS confusion are rejected. | `an alg:none token is refused`; `an RS256 token handed to the HS strategy is refused` |
| 2 | `validate()` returns `{ sub }` only; no scope, role or email claim is minted or read. | `a token with the active kid and correct iss/aud/alg verifies and yields { sub } only` |
| 3 | argon2id parameters are pinned, and a credential whose scheme is not enabled is refused. | `pins argon2id parameters rather than taking consumer defaults`; `a stored hash that is not argon2id is refused` |
| 4 | The bcrypt provider is off by default, opt-in only, and the unknown-email path is constant-time-bounded. | `a bcrypt credential is refused when the provider is off`; `verifyDummy resolves for an unknown subject so the timing matches a real verify` |
| 5 | Refresh and reset tokens are stored hashed; no plaintext credential or token column exists. | `mints 32 random bytes and stores only their SHA-256 hex`; `no plaintext credential or token column exists` |
| 6 | Rotation sets `used_at`; a consumed token outside the grace revokes the family, inside the grace re-issues. | `a valid refresh rotates into a new token in the same family and marks the old one used`; `a consumed refresh outside the grace revokes the whole family and throws`; `a consumed refresh inside the grace re-issues and does not revoke` |
| 7 | The reset token is single-use and is never a JWT. | `refuses a token consumed twice`; `mints a token for a known subject and hands it to the sink without storing the plaintext` |
| 8 | Guards are order-fixed `JwtAuth` then `Scope` then `Permission`, default-deny. | `registers JwtAuth, Scope and Permission globally, in that order`; `a route with none of the three decorators throws MissingRouteGuardError` |
| 9 | No credential, token or reset token reaches a log; `DEFAULT_REDACT_PATHS` covers them. | `reuse detection emits auth.refresh.reuse_detected and never the token`; `records every attempt with a hashed email and never the password or the plaintext email` |
