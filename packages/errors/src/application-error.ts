import { DomainError } from './domain-error';

export abstract class ApplicationError extends Error {
  abstract readonly code: string;
  readonly statusCode: number = 500;
  readonly criteria?: unknown;

  constructor(criteria?: unknown) {
    super();
    this.criteria = criteria;
  }

  static fromDomain(error: unknown): ApplicationError {
    const translated =
      error instanceof DomainError
        ? new DomainApplicationError(error.code, error.criteria)
        : new InternalApplicationError();
    Object.defineProperty(translated, 'cause', { value: error });
    return translated;
  }
}

// fromDomain returns an InfrastructureError, so it lives beside fromDomain; importing it
// from kinds.ts would make the two modules extend each other before either is initialised.
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
