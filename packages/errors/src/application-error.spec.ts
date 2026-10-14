import { describe, expect, it } from 'vitest';
import { ApplicationError, InfrastructureError } from './application-error';
import { DomainError } from './domain-error';

class SampleDomainError extends DomainError {
  readonly code = 'SAMPLE_FAILED';
}

describe('ApplicationError.fromDomain', () => {
  it('fromDomain preserves code and criteria', () => {
    const criteria = { field: 'email' };

    const translated = ApplicationError.fromDomain(new SampleDomainError(criteria));

    expect(translated).toBeInstanceOf(ApplicationError);
    expect(translated.code).toBe('SAMPLE_FAILED');
    expect(translated.criteria).toBe(criteria);
    expect(translated.statusCode).toBe(500);
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

  it('criteria is passed through by reference, unchanged', () => {
    const criteria = { attempt: 3 };

    const translated = ApplicationError.fromDomain(new SampleDomainError(criteria));

    expect(translated.criteria).toBe(criteria);
  });

  it('the original error is retained as a non-enumerable cause', () => {
    const original = new Error('connection string postgres://user:secret@host');

    const translated = ApplicationError.fromDomain(original);

    expect(translated.cause).toBe(original);
    expect(Object.keys(translated)).not.toContain('cause');
  });
});
