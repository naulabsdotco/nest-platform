export abstract class DomainError extends Error {
  abstract readonly code: string;
  readonly criteria?: unknown;

  constructor(criteria?: unknown) {
    super();
    this.criteria = criteria;
  }
}
