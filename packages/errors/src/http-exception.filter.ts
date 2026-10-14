import { Catch } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter, Type } from '@nestjs/common';
import { ZodError } from 'zod';
import { ApplicationError } from './application-error.js';
import { ValidationError } from './kinds.js';
import type { EnvelopeSerializer, ErrorRequest } from './serializer.js';

class RequestValidationError extends ValidationError {
  readonly code = 'REQUEST_VALIDATION_FAILED';
}

const toApplicationError = (error: unknown): ApplicationError => {
  if (error instanceof ApplicationError) return error;
  if (error instanceof ZodError) return new RequestValidationError();
  return ApplicationError.fromDomain(error);
};

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  constructor(private readonly serializer: EnvelopeSerializer) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const error = toApplicationError(exception);
    const request = context.getRequest<ErrorRequest>();
    const body = this.serializer.serialize(
      error,
      { method: request.method, path: request.path },
      new Date().toISOString(),
    );
    context
      .getResponse<{ status(code: number): { json(body: unknown): unknown } }>()
      .status(error.statusCode)
      .json(body);
  }
}

export function createExceptionFilter(serializer: EnvelopeSerializer): Type<ExceptionFilter> {
  @Catch()
  class ConfiguredExceptionFilter extends HttpExceptionFilter {
    constructor() {
      super(serializer);
    }
  }

  return ConfiguredExceptionFilter;
}
