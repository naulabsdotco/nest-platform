import type { IncomingMessage, ServerResponse } from 'node:http';
import { Logger, LoggerModule, PARAMS_PROVIDER_TOKEN, type Params } from 'nestjs-pino';
import pinoHttp, { type Options } from 'pino-http';
import { describe, expect, it } from 'vitest';
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
});
