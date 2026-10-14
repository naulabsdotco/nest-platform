import { Logger, NotFoundException } from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';
import { ApplicationError, InfrastructureError } from './application-error';
import { HttpExceptionFilter, createExceptionFilter } from './http-exception.filter';
import { NotFoundError } from './kinds';
import { defaultEnvelopeSerializer, type EnvelopeSerializer, type ErrorRequest } from './serializer';

class ProjectNotFound extends NotFoundError {
  readonly code = 'PROJECT_NOT_FOUND';
}

class DatabaseError extends InfrastructureError {
  readonly code = 'DB_UNAVAILABLE';
}

const hostFor = (request: ErrorRequest = { method: 'GET', path: '/projects/1' }) => {
  const response = {
    code: 0,
    body: undefined as unknown,
    status(code: number) { this.code = code; return this; },
    json(body: unknown) { this.body = body; return this; },
  };
  const argumentsHost = {
    getType: () => 'http',
    switchToHttp: () => ({ getResponse: () => response, getRequest: () => request }),
  } as unknown as ArgumentsHost;
  return { response, argumentsHost };
};

const render = (error: unknown, serializer = defaultEnvelopeSerializer(), request?: ErrorRequest) => {
  const { response, argumentsHost } = hostFor(request);
  new HttpExceptionFilter(serializer).catch(error, argumentsHost);
  return response;
};

beforeEach(() => {
  vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('HttpExceptionFilter', () => {
  it('an ApplicationError renders its status, code and criteria through the serializer', () => {
    const response = render(new ProjectNotFound({ id: '1' }));

    expect(response.body).toMatchObject({
      statusCode: 404,
      errorCode: 'PROJECT_NOT_FOUND',
      path: '/projects/1',
      method: 'GET',
      criteria: { id: '1' },
    });
  });

  it('the default envelope is { statusCode, message, errorCode, timestamp, path, method, criteria? }', () => {
    const withCriteria = render(new ProjectNotFound({ id: '1' })).body as Record<string, unknown>;
    const withoutCriteria = render(new ProjectNotFound()).body as Record<string, unknown>;

    expect(Object.keys(withCriteria).sort()).toEqual([
      'criteria',
      'errorCode',
      'message',
      'method',
      'path',
      'statusCode',
      'timestamp',
    ]);
    expect(Object.keys(withoutCriteria)).not.toContain('criteria');
  });

  it('an unknown error renders 500 INTERNAL_ERROR with no message, stack or SQL', () => {
    const body = render(new Error('SELECT * FROM subject WHERE password = $1')).body as Record<string, unknown>;

    expect(body.statusCode).toBe(500);
    expect(body.errorCode).toBe('INTERNAL_ERROR');
    expect(body.message).toBe('');
    expect(body.stack).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain('SELECT');
  });

  it('a 500 never serializes criteria', () => {
    const body = render(new DatabaseError({ host: 'db-1' })).body as Record<string, unknown>;

    expect(body.statusCode).toBe(500);
    expect(body).not.toHaveProperty('criteria');
  });

  it('a Nest HttpException renders its status with a non-leaking code', () => {
    const body = render(new NotFoundException('project 42 does not exist')).body as Record<string, unknown>;

    expect(body.statusCode).toBe(404);
    expect(body.errorCode).toBe('HTTP_404');
    expect(body.message).toBe('');
    expect(JSON.stringify(body)).not.toContain('project 42');
  });

  it('a ZodError renders 400 REQUEST_VALIDATION_FAILED without leaking the schema', () => {
    const error = new ZodError([{ code: 'custom', path: ['email'], message: 'schema-secret' }]);

    const body = render(error).body as Record<string, unknown>;

    expect(body.statusCode).toBe(400);
    expect(body.errorCode).toBe('REQUEST_VALIDATION_FAILED');
    expect(JSON.stringify(body)).not.toContain('schema-secret');
  });

  it('the injected serializer receives { statusCode, message, errorCode, timestamp, path, method, criteria? }', () => {
    const captured: { error?: ApplicationError; req?: ErrorRequest; timestamp?: string } = {};
    const serializer: EnvelopeSerializer = {
      serialize(error, req, timestamp) {
        Object.assign(captured, { error, req, timestamp });
        return {};
      },
    };

    render(new ProjectNotFound({ id: '1' }), serializer, { method: 'POST', path: '/projects' });

    expect(captured.error).toMatchObject({ statusCode: 404, message: '', code: 'PROJECT_NOT_FOUND', criteria: { id: '1' } });
    expect(captured.req).toEqual({ method: 'POST', path: '/projects' });
    expect(captured.timestamp).toEqual(expect.any(String));
  });

  it('replacing the serializer changes the body and nothing else', () => {
    const body = { envelope: 'custom' };

    const response = render(new ProjectNotFound(), { serialize: () => body });

    expect(response.body).toBe(body);
    expect(response.code).toBe(404);
  });

  it("the response status equals the error's statusCode", () => {
    expect(render(new ProjectNotFound()).code).toBe(404);
  });

  it('a 5xx is logged with the original error and a 4xx is not', () => {
    const original = new Error('db down');

    render(original);
    expect(Logger.prototype.error).toHaveBeenCalledWith(original);

    vi.mocked(Logger.prototype.error).mockClear();
    render(new ProjectNotFound());
    expect(Logger.prototype.error).not.toHaveBeenCalled();
  });

  it('a non-HTTP context rethrows the exception', () => {
    const original = new Error('rpc boom');
    const host = { getType: () => 'rpc' } as unknown as ArgumentsHost;

    expect(() => new HttpExceptionFilter(defaultEnvelopeSerializer()).catch(original, host)).toThrow(original);
  });

  it('createExceptionFilter returns a filter Nest can instantiate', () => {
    const { response, argumentsHost } = hostFor();
    const Filter = createExceptionFilter(defaultEnvelopeSerializer());

    new Filter().catch(new ProjectNotFound(), argumentsHost);

    expect((response.body as Record<string, unknown>).errorCode).toBe('PROJECT_NOT_FOUND');
  });
});
