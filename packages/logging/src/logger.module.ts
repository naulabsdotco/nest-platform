import type { DynamicModule } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { CORRELATION_HEADER, type CorrelationRequest, correlationIdOf } from './correlation.middleware';
import { resolveRedactPaths } from './redact';

// The field names every line carries; a consumer adds context fields, never renames these.
export const LOG_FIELDS = ['event', 'correlationId', 'outcome'] as const;

export interface LoggerOptions {
  service: string;
  level?: string;
  correlationHeader?: string;
  redactExtra?: readonly string[];
  contextFields?: readonly string[];
}

const RESERVED_FIELDS = new Set<string>(LOG_FIELDS);

function contextProps(source: Record<string, unknown>, contextFields: readonly string[]): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  for (const field of contextFields) {
    if (!RESERVED_FIELDS.has(field) && source[field] !== undefined) props[field] = source[field];
  }
  return props;
}

export function createLoggerModule(opts: LoggerOptions): DynamicModule {
  const header = opts.correlationHeader ?? CORRELATION_HEADER;
  const contextFields = opts.contextFields ?? [];
  return LoggerModule.forRoot({
    pinoHttp: {
      level: opts.level ?? 'info',
      base: { service: opts.service },
      redact: { paths: resolveRedactPaths(opts.redactExtra), censor: '[Redacted]' },
      genReqId: (req: CorrelationRequest) => correlationIdOf(req, header),
      // correlationId is bound here rather than named with customAttributeKeys, which
      // pino-http ignores unless quietReqLogger drops the request object from the line.
      customProps: (req: CorrelationRequest) => ({
        correlationId: String(req.id),
        ...contextProps(req as unknown as Record<string, unknown>, contextFields),
      }),
    },
  });
}
