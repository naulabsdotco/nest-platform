import { Catch, HttpException, Logger } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter, Type } from '@nestjs/common';
import { ApplicationError } from './application-error';
import { ValidationError } from './kinds';
import type { EnvelopeSerializer, ErrorRequest } from './serializer';

class RequestValidationError extends ValidationError {
  readonly code = 'REQUEST_VALIDATION_FAILED';
}

class HttpStatusApplicationError extends ApplicationError {
  readonly code: string;

  constructor(readonly statusCode: number) {
    super();
    this.code = statusCode >= 500 ? 'INTERNAL_ERROR' : `HTTP_${statusCode}`;
  }
}

// ZodError is not an Error in zod v4 and a consumer may hold another copy, so match its shape.
const isZodError = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  (error as { name?: unknown }).name === 'ZodError' &&
  Array.isArray((error as { issues?: unknown }).issues);

const toApplicationError = (error: unknown): ApplicationError => {
  if (error instanceof ApplicationError) return error;
  if (error instanceof HttpException) return new HttpStatusApplicationError(error.getStatus());
  if (isZodError(error)) return new RequestValidationError();
  return ApplicationError.fromDomain(error);
};

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  constructor(private readonly serializer: EnvelopeSerializer) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    if (host.getType() !== 'http') throw exception;

    const context = host.switchToHttp();
    const error = toApplicationError(exception);
    if (error.statusCode >= 500) this.logger.error(exception);

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
