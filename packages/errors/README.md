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

`ApplicationError.fromDomain` is the only place a domain error becomes an application error; call it
at the boundary:

```ts
throw ApplicationError.fromDomain(error);
```

A `DomainError` keeps its `code` and `criteria`, and `fromDomain` marks the result 500 — it is the
unexpected-error path. Raise the matching kind at the boundary when the failure is expected. Anything
else becomes a 500 `InfrastructureError` with no message, stack or original detail. Each kind fixes
its status and is abstract on `code`, so a subclass names the failure: 400 `ValidationError`, 401
`UnauthorizedError`, 403 `ForbiddenError`, 404 `NotFoundError`, 409 `ConflictError`, 500
`InfrastructureError`.

`criteria` is passed through by reference; keep credentials and tokens out of it.
