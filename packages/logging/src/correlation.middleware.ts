import { randomUUID } from 'node:crypto';

export const CORRELATION_HEADER = 'x-correlation-id';

// Inbound ids are trusted only when canonical; any other value is replaced, never logged raw.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface CorrelationRequest {
  headers: Record<string, string | string[] | undefined>;
  id?: string;
}

export interface CorrelationResponse {
  setHeader(name: string, value: string): void;
}

export type RequestHandler = (
  req: CorrelationRequest,
  res: CorrelationResponse,
  next: () => void,
) => void;

// Reads a UUID inbound id or mints one, and writes it back so a later reader sees the same value.
export function correlationIdOf(req: CorrelationRequest, header: string): string {
  const key = header.toLowerCase();
  const inbound = req.headers[key];
  const candidate = Array.isArray(inbound) ? inbound[0] : inbound;
  const correlationId = candidate && UUID_PATTERN.test(candidate) ? candidate.toLowerCase() : randomUUID();
  req.headers[key] = correlationId;
  return correlationId;
}

export function correlationMiddleware(opts: { header?: string } = {}): RequestHandler {
  const header = opts.header ?? CORRELATION_HEADER;
  return (req, res, next) => {
    res.setHeader(header, correlationIdOf(req, header));
    next();
  };
}
