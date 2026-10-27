import type { ExecutionContext } from '@nestjs/common';
import { correlationIdFrom } from './correlation.middleware';

// A message's id can only arrive in the transport's own metadata, and each transport spells
// it differently: Kafka exposes a message with `headers`, NATS a `getHeaders()` map, AMQP
// nests them under `properties.headers`. A transport carrying none gets a generated id.
interface Carrier {
  getMessage?: () => unknown;
  getHeaders?: () => unknown;
  headers?: unknown;
  properties?: { headers?: unknown };
}

function headersOf(value: unknown): unknown {
  const carrier = value as Carrier | undefined;
  return carrier?.getHeaders?.() ?? carrier?.headers ?? carrier?.properties?.headers;
}

function inboundId(headers: unknown, header: string): unknown {
  if (!headers || typeof headers !== 'object') return undefined;
  const reader = headers as { get?: (name: string) => unknown; keys?: () => Iterable<string> };
  if (typeof reader.get === 'function') {
    // A NATS header map matches exactly unless asked otherwise, and keeps the producer's case.
    const key =
      typeof reader.keys === 'function'
        ? [...reader.keys()].find((name) => name.toLowerCase() === header.toLowerCase())
        : header;
    return key === undefined ? undefined : reader.get(key);
  }
  const record = headers as Record<string, unknown>;
  const key = Object.keys(record).find((name) => name.toLowerCase() === header.toLowerCase());
  return key === undefined ? undefined : record[key];
}

// Logging never fails a message: an unreadable context yields a generated id rather than a throw.
export function messageCorrelationId(context: ExecutionContext, header: string): string {
  try {
    const carrier = context.switchToRpc().getContext<Carrier>();
    const message = typeof carrier?.getMessage === 'function' ? carrier.getMessage() : carrier;
    return correlationIdFrom(inboundId(headersOf(message) ?? headersOf(carrier), header));
  } catch {
    return correlationIdFrom(undefined);
  }
}
