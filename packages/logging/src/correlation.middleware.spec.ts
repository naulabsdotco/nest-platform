import { describe, expect, it, vi } from 'vitest';
import {
  CORRELATION_HEADER,
  correlationMiddleware,
  type CorrelationRequest,
} from './correlation.middleware';

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

  it('replaces an inbound id that is too long or carries illegal bytes', () => {
    for (const inbound of ['x'.repeat(200), 'has space\nnewline', 'é']) {
      const req = request({ [CORRELATION_HEADER]: inbound });
      const res = response();

      correlationMiddleware()(req, res, () => {});

      expect(idFrom(res)).toMatch(UUID_V4);
      expect(req.headers[CORRELATION_HEADER]).toBe(idFrom(res));
    }
  });

  it('matches the configured header name case-insensitively', () => {
    const req = request({ [CORRELATION_HEADER]: 'inbound-id' });
    const res = response();

    correlationMiddleware({ header: 'X-Correlation-Id' })(req, res, () => {});

    expect(idFrom(res)).toBe('inbound-id');
  });
});
