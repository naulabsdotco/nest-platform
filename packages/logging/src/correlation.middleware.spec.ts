import { describe, expect, it, vi } from 'vitest';
import {
  CORRELATION_HEADER,
  correlationMiddleware,
  type CorrelationLogger,
  type CorrelationRequest,
  type CorrelationResponse,
} from './correlation.middleware.js';

const request = (headers: CorrelationRequest['headers'] = {}): CorrelationRequest => ({ headers });

const response = () => ({ setHeader: vi.fn() });

const idFrom = (res: ReturnType<typeof response>): string => res.setHeader.mock.calls[0]?.[1] as string;

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('correlationMiddleware', () => {
  it('echoes an inbound correlation id on the response', () => {
    const req = request({ [CORRELATION_HEADER]: 'inbound-id' });
    const res = response();

    correlationMiddleware()(req, res, () => {});

    expect(res.setHeader).toHaveBeenCalledWith(CORRELATION_HEADER, 'inbound-id');
    expect(req.headers[CORRELATION_HEADER]).toBe('inbound-id');
  });

  it('generates an id when absent and keeps it stable within the request', () => {
    const req = request();
    const res = response();

    correlationMiddleware()(req, res, () => {});
    const generated = idFrom(res);

    expect(generated).toMatch(UUID_V4);

    const second = response();
    correlationMiddleware()(req, second, () => {});

    expect(idFrom(second)).toBe(generated);
    expect(req.headers[CORRELATION_HEADER]).toBe(generated);
  });

  it('derives no generated id from the client address or a client header', () => {
    const headers = { 'x-forwarded-for': '203.0.113.7', 'user-agent': 'client-controlled' };
    const first = response();
    const second = response();

    correlationMiddleware()(request({ ...headers }), first, () => {});
    correlationMiddleware()(request({ ...headers }), second, () => {});

    const ids = idFrom(first) + idFrom(second);
    expect(idFrom(first)).toMatch(UUID_V4);
    expect(idFrom(first)).not.toBe(idFrom(second));
    expect(ids).not.toContain('203.0.113.7');
    expect(ids).not.toContain('client-controlled');
  });

  it('binds the id onto an existing pino child logger', () => {
    const logger: CorrelationLogger = { child: vi.fn(() => logger) };
    const req = request({ [CORRELATION_HEADER]: 'inbound-id' });
    const res: CorrelationResponse = response();
    req.log = logger;

    correlationMiddleware()(req, res, () => {});

    expect(logger.child).toHaveBeenCalledWith({ correlationId: 'inbound-id' });
  });
});
