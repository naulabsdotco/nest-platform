import { describe, expect, it } from 'vitest';
import { ApplicationError, InfrastructureError, type StatusMap } from './application-error.js';
import { DomainError } from './domain-error.js';

class SampleDomainError extends DomainError {
  readonly code = 'SAMPLE_FAILED';
}

describe('ApplicationError.fromDomain', () => {
  it('a mapped DomainError keeps its code and criteria at the mapped status', () => {
    const criteria = { field: 'email' };

    const translated = ApplicationError.fromDomain(new SampleDomainError(criteria), { SAMPLE_FAILED: 404 });

    expect(translated).toBeInstanceOf(ApplicationError);
    expect(translated.code).toBe('SAMPLE_FAILED');
    expect(translated.criteria).toBe(criteria);
    expect(translated.statusCode).toBe(404);
  });

  it('an unmapped DomainError becomes a 500 InfrastructureError with no detail', () => {
    const translated = ApplicationError.fromDomain(new SampleDomainError({ field: 'email' }));

    expect(translated).toBeInstanceOf(InfrastructureError);
    expect(translated.statusCode).toBe(500);
    expect(translated.code).toBe('INTERNAL_ERROR');
    expect(translated.criteria).toBeUndefined();
  });

  it('a mapped status outside 400-599 fails closed to 500', () => {
    for (const status of [200, 302, 399, 600, 999]) {
      const translated = ApplicationError.fromDomain(new SampleDomainError(), { SAMPLE_FAILED: status });

      expect(translated.statusCode).toBe(500);
      expect(translated.code).toBe('INTERNAL_ERROR');
    }
  });

  it('a subclass supplies its own code and status', () => {
    class PaymentRequiredError extends ApplicationError {
      readonly code = 'PAYMENT_REQUIRED';
      readonly statusCode = 402;
    }

    const error = new PaymentRequiredError();

    expect(error.code).toBe('PAYMENT_REQUIRED');
    expect(error.statusCode).toBe(402);
  });

  it('a non-domain error becomes a 500 InfrastructureError with no detail', () => {
    const original = new Error('connection string postgres://user:secret@host');

    const translated = ApplicationError.fromDomain(original);

    expect(translated).toBeInstanceOf(InfrastructureError);
    expect(translated.statusCode).toBe(500);
    expect(translated.code).toBe('INTERNAL_ERROR');
    expect(translated.message).toBe('');
    expect(translated.criteria).toBeUndefined();
  });

  it('fromDomain does not copy the original stack or message onto a 500', () => {
    const original = new Error('password=hunter2');
    original.stack = 'Error: password=hunter2\n    at connection';

    const translated = ApplicationError.fromDomain(original);

    expect(translated.stack).not.toBe(original.stack);
    expect(translated.stack).not.toContain('hunter2');
    expect(translated.message).not.toContain('hunter2');
  });

  it('the original error is retained as a non-enumerable cause', () => {
    const original = new Error('connection string postgres://user:secret@host');

    const translated = ApplicationError.fromDomain(original);

    expect(translated.cause).toBe(original);
    expect(Object.keys(translated)).not.toContain('cause');
  });

  it('a typed map rejects unknown codes at compile time', () => {
    type Code = 'SAMPLE_FAILED' | 'PLAN_EXPIRED';
    const statusFor: StatusMap<Code> = { SAMPLE_FAILED: 404, PLAN_EXPIRED: 402 };

    expect(ApplicationError.fromDomain(new SampleDomainError(), statusFor).statusCode).toBe(404);

    // @ts-expect-error OWNER_UNKNOWN is not one of Code
    const unknown: StatusMap<Code> = { OWNER_UNKNOWN: 404 };

    expect(Object.keys(unknown)).toEqual(['OWNER_UNKNOWN']);
  });
});
