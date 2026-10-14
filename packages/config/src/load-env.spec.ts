import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ConfigValidationError } from './errors';
import { loadEnv } from './load-env';

const schema = z.object({
  SERVICE: z.string(),
  PORT: z.coerce.number().default(3000),
  MODE: z.enum(['dev', 'prod']).default('dev'),
});

describe('loadEnv', () => {
  it('a complete environment parses and applies schema defaults', () => {
    expect(loadEnv(schema, { SERVICE: 'svc' })).toEqual({ SERVICE: 'svc', PORT: 3000, MODE: 'dev' });
  });

  it('a missing required key throws ConfigValidationError naming the key', () => {
    let thrown: unknown;
    try {
      loadEnv(schema, {});
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ConfigValidationError);
    expect((thrown as ConfigValidationError).code).toBe('CONFIG_INVALID');
    expect((thrown as ConfigValidationError).missing).toContain('SERVICE');
  });

  it('the thrown message contains no value read from the environment', () => {
    const raw = { SERVICE: 'top-secret-value', PORT: 'not-a-number' };

    let message = '';
    try {
      loadEnv(schema, raw);
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toContain('PORT');
    expect(message).not.toContain('top-secret-value');
    expect(message).not.toContain('not-a-number');
  });

  it('unknown keys are stripped, not rejected', () => {
    expect(loadEnv(schema, { SERVICE: 'svc', EXTRA: 'ignored' })).not.toHaveProperty('EXTRA');
  });

  it('a coerced value is typed on the result', () => {
    expect(loadEnv(schema, { SERVICE: 'svc', PORT: '8080' }).PORT).toBe(8080);
  });
});
