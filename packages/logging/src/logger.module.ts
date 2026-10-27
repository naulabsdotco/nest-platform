import type { DynamicModule, ExecutionContext } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import type { DestinationStream } from 'pino';
import { CORRELATION_HEADER, type CorrelationRequest, correlationIdOf } from './correlation.middleware';
import { resolveRedactPaths } from './redact';
import { messageCorrelationId } from './rpc.correlation';

// The field names every line carries; a consumer adds context fields, never renames these.
export const LOG_FIELDS = ['event', 'correlationId', 'outcome'] as const;

export interface LoggerOptions {
  service: string;
  level?: string;
  correlationHeader?: string;
  redactExtra?: readonly string[];
  contextFields?: readonly string[];
  microservice?: boolean;
  destination?: DestinationStream;
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
  const microservice = opts.microservice === true;
  return LoggerModule.forRoot({
    // A field assigned mid-message belongs on the line that closes it, not only on the
    // lines logged after the assign.
    assignResponse: microservice,
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
      stream: opts.destination,
    },
    ...(microservice
      ? {
          microservice: {
            genReqId: (context: ExecutionContext) => messageCorrelationId(context, header),
            customAttributeKeys: { reqId: 'correlationId', responseTime: 'durationMs' },
          },
        }
      : {}),
  });
}
