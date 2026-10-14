import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { DEFAULT_REDACT_PATHS, resolveRedactPaths } from './redact.js';

const lineFor = (paths: readonly string[], record: Record<string, unknown>): string => {
  const lines: string[] = [];
  pino({ redact: { paths: [...paths], censor: '[Redacted]' } }, { write: (line) => void lines.push(line) }).info(
    record,
    'in',
  );
  return lines.join('\n');
};

describe('resolveRedactPaths', () => {
  it('redacts the authorization header, password, token and credential bodies', () => {
    const line = lineFor(DEFAULT_REDACT_PATHS, {
      req: { headers: { authorization: 'Bearer secret' } },
      password: 'hunter2',
      token: 'raw-token',
      credential: 'raw-credential',
    });

    expect(line).not.toContain('Bearer secret');
    expect(line).not.toContain('hunter2');
    expect(line).not.toContain('raw-token');
    expect(line).not.toContain('raw-credential');
  });

  it('redacts an extra path in addition to the defaults', () => {
    const line = lineFor(resolveRedactPaths(['subjectEmail']), {
      password: 'hunter2',
      subjectEmail: 'subject@example-app.test',
    });

    expect(line).not.toContain('hunter2');
    expect(line).not.toContain('subject@example-app.test');
  });

  it('cannot empty the default redaction list', () => {
    expect(resolveRedactPaths([])).toEqual([...DEFAULT_REDACT_PATHS]);
  });
});
