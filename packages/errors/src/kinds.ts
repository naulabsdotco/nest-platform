import { ApplicationError } from './application-error.js';

export abstract class ValidationError extends ApplicationError {
  readonly statusCode = 400;
}

export abstract class UnauthorizedError extends ApplicationError {
  readonly statusCode = 401;
}

export abstract class ForbiddenError extends ApplicationError {
  readonly statusCode = 403;
}

export abstract class NotFoundError extends ApplicationError {
  readonly statusCode = 404;
}

export abstract class ConflictError extends ApplicationError {
  readonly statusCode = 409;
}
