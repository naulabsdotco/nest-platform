import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Logger, LoggerModule, PARAMS_PROVIDER_TOKEN, type Params } from 'nestjs-pino';
import pinoHttp, { type Options } from 'pino-http';
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { AutoEvents } from './index';
import { DEFAULT_REDACT_PATHS } from './redact';
import { LOG_FIELDS, createLoggerModule, type LoggerOptions } from './logger.module';

const paramsOf = (opts: LoggerOptions): Params => {
  const providers = (createLoggerModule(opts).providers ?? []) as Array<{
    provide?: unknown;
    useValue?: Params;
  }>;
  const provider = providers.find((candidate) => candidate.provide === PARAMS_PROVIDER_TOKEN);
  if (!provider?.useValue) throw new Error('the module provides no pino params');
  return provider.useValue;
};

const lineFor = (opts: LoggerOptions, request: Record<string, unknown>): Record<string, unknown> => {
  const lines: string[] = [];
  const handler = pinoHttp({
    ...(paramsOf(opts).pinoHttp as Options),
    stream: { write: (chunk) => void lines.push(chunk) },
    autoLogging: false,
  });
  const req = { headers: {}, ...request };
  const res = { setHeader() {}, removeListener() {}, on() {}, end() {}, statusCode: 200, writableEnded: true };
  handler(req as unknown as IncomingMessage, res as unknown as ServerResponse, () => {});
  const { log } = req as unknown as { log: { info(fields: object, message: string): void } };
  log.info({ event: 'handler' }, 'handler');
  return JSON.parse(lines[lines.length - 1] ?? '{}');
};

const automaticLineFor = (
  opts: LoggerOptions,
  request: Record<string, unknown> = {},
  statusCode = 200,
  event?: string,
): Record<string, unknown> => {
  const lines: string[] = [];
  const handler = pinoHttp({
    ...(paramsOf(opts).pinoHttp as Options),
    stream: { write: (chunk) => void lines.push(chunk) },
  });
  const req = { headers: {}, ...request };
  const res = Object.assign(new EventEmitter(), { setHeader() {}, statusCode });
  handler(req as unknown as IncomingMessage, res as unknown as ServerResponse, () => {});
  if (event) (res as unknown as { log: { setBindings(fields: object): void } }).log.setBindings({ event });
  res.emit('finish');
  return JSON.parse(lines[lines.length - 1] ?? '{}');
};

describe('automatic line events', () => {
  it('names the event on the automatic HTTP success and error lines', () => {
    const opts = { service: 'example-app', autoEvents: { request: 'http.request' } };
    expectTypeOf<AutoEvents>().toEqualTypeOf<{ request?: string; message?: string }>();
    expect(automaticLineFor(opts).event).toBe('http.request');
    expect(automaticLineFor(opts, {}, 500).event).toBe('http.request');
  });

  it('leaves automatic HTTP lines without an event by default', () => {
    expect(automaticLineFor({ service: 'example-app' }).event).toBeUndefined();
    expect(automaticLineFor({ service: 'example-app' }, {}, 500).event).toBeUndefined();
  });

  it('lets a handler-assigned event win on the automatic HTTP line', () => {
    const opts = { service: 'example-app', autoEvents: { request: 'http.request' } };
    const inbound = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
    const automatic = automaticLineFor(opts, { headers: { 'x-correlation-id': inbound } }, 200, 'handler-event');
    const handler = lineFor(opts, { headers: { 'x-correlation-id': inbound } });

    expect(automatic.event).toBe('handler-event');
    expect(automatic.correlationId).toBe(inbound);
    expect(handler.event).toBe('handler');
    expect(handler.msg).toBe('handler');
  });

  it('rejects an empty, whitespace or non-string event name', () => {
    for (const name of ['', '   ', 42 as unknown as string]) {
      expect(() => createLoggerModule({ service: 'example-app', autoEvents: { request: name } })).toThrow(TypeError);
      expect(() => createLoggerModule({ service: 'example-app', autoEvents: { message: name } })).toThrow(TypeError);
    }
  });
});

describe('createLoggerModule', () => {
  it('provides a logger and binds correlationId on the emitted line', () => {
    const module = createLoggerModule({ service: 'example-app' });

    expect(module.module).toBe(LoggerModule);
    expect(module.exports).toContain(Logger);
    const inbound = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
    expect(lineFor({ service: 'example-app' }, { headers: { 'x-correlation-id': inbound } }).correlationId).toBe(
      inbound,
    );
  });

  it('adds a consumer context field to the emitted line', () => {
    const emitted = lineFor({ service: 'example-app', contextFields: ['tenantId'] }, { tenantId: 'acme' });

    expect(emitted.tenantId).toBe('acme');
  });

  it('never lets a consumer context field shadow a reserved name', () => {
    const emitted = lineFor(
      { service: 'example-app', contextFields: [...LOG_FIELDS] },
      { event: 'renamed', correlationId: 'renamed', outcome: 'renamed' },
    );

    expect(LOG_FIELDS).toEqual(['event', 'correlationId', 'outcome']);
    expect(emitted.event).toBe('handler');
    expect(emitted.correlationId).not.toBe('renamed');
  });

  it('appends consumer redactions without dropping the defaults', () => {
    const { redact } = paramsOf({ service: 'example-app', redactExtra: ['subjectEmail'] }).pinoHttp as Options;

    expect((redact as { paths: string[] }).paths).toEqual([...DEFAULT_REDACT_PATHS, 'subjectEmail']);
  });

  it('leaves the HTTP path alone unless microservice logging is asked for', () => {
    const params = paramsOf({ service: 'example-app' });

    expect(params.microservice).toBeUndefined();
    expect(params.assignResponse).toBeFalsy();
  });

  it('binds assigned fields on the closing line of both transports when microservice logging is on', () => {
    expect(paramsOf({ service: 'example-app', microservice: true }).assignResponse).toBe(true);
  });

  it('writes the lines to a consumer-supplied destination', () => {
    const destination = { write: () => {} };

    expect((paramsOf({ service: 'example-app', destination }).pinoHttp as Options).stream).toBe(destination);
  });
});
