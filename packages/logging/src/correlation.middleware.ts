import { randomUUID } from 'node:crypto';

export const CORRELATION_HEADER = 'x-correlation-id';

// An inbound id is echoed and bound, so trust only a bounded, printable token.
const CORRELATION_ID_PATTERN = /^[A-Za-z0-9._:-]{1,64}$/;

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

// Reads the inbound id or mints one, and writes it back so a later reader sees the same value.
export function correlationIdOf(req: CorrelationRequest, header: string): string {
  const key = header.toLowerCase();
  const inbound = req.headers[key];
  const candidate = Array.isArray(inbound) ? inbound[0] : inbound;
  const correlationId = candidate && CORRELATION_ID_PATTERN.test(candidate) ? candidate : randomUUID();
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
