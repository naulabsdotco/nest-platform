# @naulabs/errors

A consumer-agnostic error taxonomy: raise a typed error, translate it at one boundary, and render it
through an envelope you supply.

## Errors

A domain raises a plain `DomainError` subclass with its own code and the criteria a caller may see:

```ts
class PlanExpired extends DomainError {
  readonly code = 'PLAN_EXPIRED';
}

throw new PlanExpired({ plan: 'free' });
```

`ApplicationError.fromDomain` is the only place a domain error becomes an application error. Give it a
code → status map and a mapped domain error keeps its code and criteria at that status:

```ts
const statusFor = { PLAN_EXPIRED: 402 };

throw ApplicationError.fromDomain(error, statusFor);
```

An unmapped code — or anything that is not a `DomainError` — becomes a 500 `InfrastructureError` with
no message, stack or original detail, and a mapped status outside 400–599 is ignored (fail-closed).
Each kind fixes its own status and is abstract on `code`, so a subclass names the failure: 400
`ValidationError`, 401 `UnauthorizedError`, 403 `ForbiddenError`, 404 `NotFoundError`, 409
`ConflictError`, 500 `InfrastructureError`.

`criteria` is passed through by reference; keep credentials and tokens out of it.
