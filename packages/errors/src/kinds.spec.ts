import { describe, expect, it } from 'vitest';
import { InfrastructureError } from './application-error.js';
import { ConflictError, ForbiddenError, NotFoundError, UnauthorizedError, ValidationError } from './kinds.js';

class Conflict extends ConflictError { readonly code = 'CONFLICT'; }
class Forbidden extends ForbiddenError { readonly code = 'FORBIDDEN'; }
class NotFound extends NotFoundError { readonly code = 'NOT_FOUND'; }
class Unauthorized extends UnauthorizedError { readonly code = 'UNAUTHORIZED'; }
class Validation extends ValidationError { readonly code = 'VALIDATION'; }
class Infrastructure extends InfrastructureError { readonly code = 'INFRASTRUCTURE'; }

describe('error kinds', () => {
  it('each kind carries the documented status code', () => {
    expect(new Validation().statusCode).toBe(400);
    expect(new Unauthorized().statusCode).toBe(401);
    expect(new Forbidden().statusCode).toBe(403);
    expect(new NotFound().statusCode).toBe(404);
    expect(new Conflict().statusCode).toBe(409);
    expect(new Infrastructure().statusCode).toBe(500);
  });

  it('a kind cannot be instantiated without a code', () => {
    // @ts-expect-error a kind is abstract on code; a subclass supplies its own.
    class MissingCode extends NotFoundError {}

    expect(MissingCode).toBeDefined();
  });
});
