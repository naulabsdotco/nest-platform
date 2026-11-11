import type { DynamicModule, ExecutionContext } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import type { DestinationStream, Logger, LogFn } from 'pino';
import { CORRELATION_HEADER, type CorrelationRequest, correlationIdOf } from './correlation.middleware';
import { resolveRedactPaths } from './redact';
import { messageCorrelationId } from './rpc.correlation';

// The field names every line carries; a consumer adds context fields, never renames these.
export const LOG_FIELDS = ['event', 'correlationId', 'outcome'] as const;

export interface AutoEvents {
  request?: string;
  message?: string;
}

export interface LoggerOptions {
  service: string;
  level?: string;
  correlationHeader?: string;
  redactExtra?: readonly string[];
  contextFields?: readonly string[];
  microservice?: boolean;
  autoEvents?: AutoEvents;
  destination?: DestinationStream;
}

const PINO_AUTOMATIC = ['level', 'time', 'msg', 'pid', 'hostname', 'v'] as const;
const HTTP_AUTOMATIC = ['req', 'res', 'err', 'responseTime'] as const;
const MODULE_DERIVED = ['service', 'durationMs', 'rpc'] as const;

const RESERVED_FIELDS = new Set<string>([
  ...LOG_FIELDS,
  ...PINO_AUTOMATIC,
  ...HTTP_AUTOMATIC,
  ...MODULE_DERIVED,
]);

function eventName(value: unknown, option: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${option} must be a non-empty string`);
  }
  return value;
}

const AUTO_EVENT = Symbol('automaticEvent');

function autoEventHook(this: Logger, args: Parameters<LogFn>, method: LogFn): void {
  const first = args[0] as { [AUTO_EVENT]?: string; event?: string } | null;
  const event = first && typeof first === 'object' ? first[AUTO_EVENT] : undefined;
  if (event !== undefined && first && this.bindings().event === undefined) first.event = event;
  method.apply(this, args);
}

function contextProps(source: Record<string, unknown>, contextFields: readonly string[]): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  for (const field of contextFields) {
    if (!RESERVED_FIELDS.has(field) && source[field] !== undefined) props[field] = source[field];
  }
  return props;
}

// Message data is the consumer's; anything that is not a plain object has no fields to read.
function messageData(context: ExecutionContext): Record<string, unknown> {
  try {
    const data = context.switchToRpc().getData();
    return data !== null && typeof data === 'object' && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export function createLoggerModule(opts: LoggerOptions): DynamicModule {
  const header = opts.correlationHeader ?? CORRELATION_HEADER;
  const contextFields = opts.contextFields ?? [];
  const microservice = opts.microservice === true;
  const requestEvent = eventName(opts.autoEvents?.request, 'autoEvents.request');
  const messageEvent = eventName(opts.autoEvents?.message, 'autoEvents.message');
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
      ...(requestEvent
        ? {
            customSuccessObject: (_req: unknown, _res: unknown, value: object) =>
              ({ ...value, [AUTO_EVENT]: requestEvent }),
            customErrorObject: (_req: unknown, _res: unknown, _error: unknown, value: object) =>
              ({ ...value, [AUTO_EVENT]: requestEvent }),
          }
        : {}),
      hooks: { logMethod: autoEventHook },
      stream: opts.destination,
    },
    ...(microservice
      ? {
          microservice: {
            genReqId: (context: ExecutionContext) => messageCorrelationId(context, header),
            customAttributeKeys: { reqId: 'correlationId', responseTime: 'durationMs' },
            ...(contextFields.length > 0
              ? {
                  customProps: (context: ExecutionContext) =>
                    contextProps(messageData(context), contextFields),
                }
              : {}),
            ...(messageEvent
              ? {
                  customSuccessObject: (_context: ExecutionContext, _result: unknown, value: object) =>
                    ({ ...value, [AUTO_EVENT]: messageEvent }),
                  customErrorObject: (_context: ExecutionContext, _error: unknown, value: object) =>
                    ({ ...value, [AUTO_EVENT]: messageEvent }),
                }
              : {}),
          },
        }
      : {}),
  });
}
