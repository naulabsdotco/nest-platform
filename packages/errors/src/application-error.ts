import { DomainError } from './domain-error.js';

export abstract class ApplicationError extends Error {
  abstract readonly code: string;
  readonly statusCode: number = 500;
  readonly criteria?: unknown;

  constructor(criteria?: unknown) {
    super();
    this.criteria = criteria;
  }

  static fromDomain(error: unknown): ApplicationError {
    if (error instanceof DomainError) {
      return new DomainApplicationError(error.code, error.criteria);
    }
    return new InternalApplicationError();
  }
}

export abstract class InfrastructureError extends ApplicationError {}

class InternalApplicationError extends InfrastructureError {
  readonly code = 'INTERNAL_ERROR';
}

class DomainApplicationError extends ApplicationError {
  constructor(
    readonly code: string,
    criteria?: unknown,
  ) {
    super(criteria);
  }
}
