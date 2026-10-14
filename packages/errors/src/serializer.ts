import type { ApplicationError } from './application-error';

export interface ErrorRequest {
  readonly method: string;
  readonly path: string;
}

export interface EnvelopeSerializer {
  serialize(error: ApplicationError, req: ErrorRequest, timestamp: string): unknown;
}

export function defaultEnvelopeSerializer(): EnvelopeSerializer {
  return {
    serialize(error, req, timestamp) {
      return {
        statusCode: error.statusCode,
        message: error.message,
        errorCode: error.code,
        timestamp,
        path: req.path,
        method: req.method,
        ...(error.statusCode < 500 && error.criteria !== undefined ? { criteria: error.criteria } : {}),
      };
    },
  };
}
