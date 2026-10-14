import { randomUUID } from 'node:crypto';

export const CORRELATION_HEADER = 'x-correlation-id';

export interface CorrelationLogger {
  child(bindings: Record<string, unknown>): CorrelationLogger;
}

export interface CorrelationRequest {
  headers: Record<string, string | string[] | undefined>;
  log?: CorrelationLogger;
}

export interface CorrelationResponse {
  setHeader(name: string, value: string): void;
}

export type RequestHandler = (
  req: CorrelationRequest,
  res: CorrelationResponse,
  next: () => void,
) => void;

export function correlationIdOf(req: CorrelationRequest, header: string): string {
  const inbound = req.headers[header];
  const value = Array.isArray(inbound) ? inbound[0] : inbound;
  return value ? value : randomUUID();
}

export function correlationMiddleware(opts: { header?: string } = {}): RequestHandler {
  const header = opts.header ?? CORRELATION_HEADER;
  return (req, res, next) => {
    const correlationId = correlationIdOf(req, header);
    req.headers[header] = correlationId;
    res.setHeader(header, correlationId);
    // pino-http may already have bound a child; rebind it so the id reaches every line.
    if (req.log) req.log = req.log.child({ correlationId });
    next();
  };
}
