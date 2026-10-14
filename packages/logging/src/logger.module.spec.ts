import type { IncomingMessage } from 'node:http';
import { Logger, LoggerModule } from 'nestjs-pino';
import { describe, expect, it } from 'vitest';
import { DEFAULT_REDACT_PATHS } from './redact.js';
import { LOG_FIELDS, createLoggerModule, loggerOptions } from './logger.module.js';

const asRequest = (value: Record<string, unknown>): IncomingMessage => value as unknown as IncomingMessage;

describe('createLoggerModule', () => {
  it('provides a logger and a request child carrying correlationId', () => {
    const module = createLoggerModule({ service: 'example-app' });
    const options = loggerOptions({ service: 'example-app' });

    expect(module.module).toBe(LoggerModule);
    expect(module.exports).toContain(Logger);
    expect(options.customAttributeKeys).toEqual({ reqId: 'correlationId' });
    expect(options.genReqId(asRequest({ headers: { 'x-correlation-id': 'inbound-id' } }))).toBe(
      'inbound-id',
    );
  });

  it('appends consumer redactions without dropping the defaults', () => {
    const options = loggerOptions({ service: 'example-app', redactExtra: ['subjectEmail'] });

    expect(options.redact.paths).toEqual([...DEFAULT_REDACT_PATHS, 'subjectEmail']);
  });

  it('adds a consumer context field to the line but never a reserved one', () => {
    const options = loggerOptions({ service: 'example-app', contextFields: ['tenantId', ...LOG_FIELDS] });
    const line = options.customProps(
      asRequest({ tenantId: 'acme', event: 'renamed', correlationId: 'renamed', outcome: 'renamed' }),
    );

    expect(LOG_FIELDS).toEqual(['event', 'correlationId', 'outcome']);
    expect(line).toEqual({ tenantId: 'acme' });
  });
});
