import { describe, expect, it, vi } from 'vitest';
import {
  CORRELATION_HEADER,
  correlationMiddleware,
  type CorrelationRequest,
} from './correlation.middleware.js';

const request = (headers: CorrelationRequest['headers'] = {}): CorrelationRequest => ({ headers });

const response = () => ({ setHeader: vi.fn() });

const idFrom = (res: ReturnType<typeof response>): string => res.setHeader.mock.calls[0]?.[1] as string;

const UUID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('correlationMiddleware', () => {
  it('echoes an inbound UUID on the response', () => {
    const req = request({ [CORRELATION_HEADER]: UUID });
    const res = response();

    correlationMiddleware()(req, res, () => {});

    expect(res.setHeader).toHaveBeenCalledWith(CORRELATION_HEADER, UUID);
    expect(req.headers[CORRELATION_HEADER]).toBe(UUID);
  });

  it('pins an uppercase inbound UUID to canonical lowercase', () => {
    const req = request({ [CORRELATION_HEADER]: UUID.toUpperCase() });
    const res = response();

    correlationMiddleware()(req, res, () => {});

    expect(idFrom(res)).toBe(UUID);
    expect(req.headers[CORRELATION_HEADER]).toBe(UUID);
  });

  it('generates a UUID when the header is absent and keeps it stable within the request', () => {
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

  it('replaces a non-UUID inbound id with a fresh UUID', () => {
    const rejected = [
      '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
      'Root=1-5759e988-bd862e3fe1be46a994272793',
      'abc\ndef',
      'x'.repeat(65),
    ];

    for (const inbound of rejected) {
      const req = request({ [CORRELATION_HEADER]: inbound });
      const res = response();

      correlationMiddleware()(req, res, () => {});

      expect(idFrom(res)).toMatch(UUID_V4);
      expect(idFrom(res)).not.toBe(inbound);
      expect(req.headers[CORRELATION_HEADER]).toBe(idFrom(res));
    }
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

  it('matches the configured header name case-insensitively', () => {
    const req = request({ [CORRELATION_HEADER]: UUID });
    const res = response();

    correlationMiddleware({ header: 'X-Correlation-Id' })(req, res, () => {});

    expect(idFrom(res)).toBe(UUID);
  });
});
