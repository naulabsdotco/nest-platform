import type { DynamicModule, ExecutionContext } from '@nestjs/common';
import { LoggerModule, type PinoLogger } from 'nestjs-pino';
import type { DestinationStream, Logger, LogFn } from 'pino';
import {
  CORRELATION_HEADER,
  type CorrelationRequest,
  correlationIdFrom,
  correlationIdOf,
} from './correlation.middleware';
import { resolveRedactPaths } from './redact';
import { messageCorrelationId } from './rpc.correlation';

// The field names every line carries; a consumer adds context fields, never renames these.
export const LOG_FIELDS = ['event', 'correlationId', 'outcome'] as const;

export interface AutoEvents {
  request?: string;
  message?: string;
}

export interface MicroserviceLoggerOptions {
  genReqId?: (context: ExecutionContext) => string | Buffer | readonly string[];
}

export interface LoggerOptions {
  service: string;
  level?: string;
  correlationHeader?: string;
  redactExtra?: readonly string[];
  contextFields?: readonly string[];
  microservice?: boolean | MicroserviceLoggerOptions;
  autoEvents?: AutoEvents;
  customAttributeKeys?: { responseTime?: string };
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

// Renaming req/res/err would move a redacted secret out of the redaction path.
const DURATION_TARGETS = new Set(
  [...RESERVED_FIELDS].filter((name) => name !== 'responseTime' && name !== 'durationMs'),
);

function durationKeyOption(value: unknown): { responseTime?: string } | undefined {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('customAttributeKeys must be an object');
  }
  const option = value as Record<string, unknown>;
  for (const key of Object.keys(option)) {
    if (key !== 'responseTime') {
      throw new TypeError(`customAttributeKeys.${key} is not supported; only responseTime may be renamed`);
    }
  }
  const target = option.responseTime;
  if (target === undefined) return {};
  if (typeof target !== 'string' || target.trim() === '') {
    throw new TypeError('customAttributeKeys.responseTime must be a non-empty string');
  }
  if (DURATION_TARGETS.has(target)) {
    throw new TypeError(`customAttributeKeys.responseTime may not target the reserved field ${target}`);
  }
  return { responseTime: target };
}

function contextProps(source: Record<string, unknown>, contextFields: readonly string[]): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  for (const field of contextFields) {
    if (!RESERVED_FIELDS.has(field) && source[field] !== undefined) props[field] = source[field];
  }
  return props;
}

// The id is bound per message, so a handler reads it rather than re-deriving it.
export function currentCorrelationId(logger: PinoLogger, key = 'correlationId'): string | undefined {
  const value = logger.logger.bindings()[key];
  return typeof value === 'string' ? value : undefined;
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
  const microserviceOptions: MicroserviceLoggerOptions | undefined =
    opts.microservice === true
      ? {}
      : typeof opts.microservice === 'object' && opts.microservice !== null
        ? opts.microservice
        : undefined;
  const microservice = microserviceOptions !== undefined;
  // An app-owned id is trusted only through the same canonical check as an inbound header;
  // an invalid return or a throw must never fail the message.
  const messageRequestId = (context: ExecutionContext): string => {
    if (microserviceOptions?.genReqId) {
      try {
        return correlationIdFrom(microserviceOptions.genReqId(context));
      } catch {
        // Fall through to the transport's own metadata.
      }
    }
    return messageCorrelationId(context, header);
  };
  const requestEvent = eventName(opts.autoEvents?.request, 'autoEvents.request');
  const messageEvent = eventName(opts.autoEvents?.message, 'autoEvents.message');
  const customAttributeKeys = durationKeyOption(opts.customAttributeKeys);
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
      ...(customAttributeKeys?.responseTime
        ? { customAttributeKeys: { responseTime: customAttributeKeys.responseTime } }
        : {}),
      stream: opts.destination,
    },
    ...(microservice
      ? {
          microservice: {
            genReqId: messageRequestId,
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
