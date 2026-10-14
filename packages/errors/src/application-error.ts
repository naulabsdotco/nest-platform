import { DomainError } from './domain-error';

export type StatusMap<C extends string = string> = Partial<Record<C, number>>;

const isClientStatus = (status: number | undefined): status is number =>
  status !== undefined && status >= 400 && status <= 599;

export abstract class ApplicationError extends Error {
  abstract readonly code: string;
  readonly statusCode: number = 500;
  readonly criteria?: unknown;

  constructor(criteria?: unknown) {
    super();
    this.criteria = criteria;
  }

  static fromDomain<C extends string = string>(error: unknown, statusFor?: StatusMap<C>): ApplicationError {
    const mapped = error instanceof DomainError ? statusFor?.[error.code as C] : undefined;
    const translated =
      error instanceof DomainError && isClientStatus(mapped)
        ? new DomainApplicationError(error.code, mapped, error.criteria)
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
    readonly statusCode: number,
    criteria?: unknown,
  ) {
    super(criteria);
  }
}
