import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import { z } from 'zod';
import { ConfigValidationError } from './errors';
import { loadEnv } from './load-env';

const schema = z.object({
  SERVICE: z.string(),
  PORT: z.coerce.number().default(3000),
  MODE: z.enum(['dev', 'prod']).default('dev'),
});

const capture = (run: () => unknown): ConfigValidationError => {
  try {
    run();
  } catch (error) {
    return error as ConfigValidationError;
  }
  throw new Error('expected loadEnv to throw');
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('loadEnv', () => {
  it('a complete environment parses and applies schema defaults', () => {
    expect(loadEnv(schema, { SERVICE: 'svc' })).toEqual({ SERVICE: 'svc', PORT: 3000, MODE: 'dev' });
  });

  it('a missing required key throws ConfigValidationError naming the key', () => {
    const error = capture(() => loadEnv(schema, {}));

    expect(error).toBeInstanceOf(ConfigValidationError);
    expect(error.code).toBe('CONFIG_INVALID');
    expect(error.missing).toContain('SERVICE');
  });

  it('the thrown error contains no value read from the environment', () => {
    const raw = { SERVICE: 'top-secret-value', MODE: 'prodd' };

    const error = capture(() => loadEnv(schema, raw));
    const surfaces = `${error.message} ${error.missing.join('|')} ${JSON.stringify(error)}`;

    expect(surfaces).toContain('MODE');
    expect(surfaces).not.toContain('top-secret-value');
    expect(surfaces).not.toContain('prodd');
  });

  it('a nested failing key is named by its dotted path', () => {
    const nested = z
      .object({ DB: z.string() })
      .superRefine((_, ctx) => ctx.addIssue({ code: 'custom', path: ['DB', 'HOST'], message: 'nope' }));

    expect(capture(() => loadEnv(nested, { DB: 'x' })).missing).toContain('DB.HOST');
  });

  it('a root-level issue is named rather than left blank', () => {
    const strict = z.object({ SERVICE: z.string() }).strict();

    const error = capture(() => loadEnv(strict, { SERVICE: 'svc', EXTRA: 'x' }));

    expect(error.missing).toContain('(root)');
    expect(error.message).toContain('(root)');
  });

  it('a symbol key is named without a raw TypeError', () => {
    const key = Symbol('credential');
    const symbolic = z.object({ [key]: z.string() });

    const error = capture(() => loadEnv(symbolic, {}));

    expect(error).toBeInstanceOf(ConfigValidationError);
    expect(error.missing.join('')).toContain('credential');
  });

  it('one key failing two checks is named once', () => {
    const password = z.object({ TOKEN: z.string().min(8).regex(/^z/) });

    const error = capture(() => loadEnv(password, { TOKEN: 'abc' }));

    expect(error.missing.filter((path) => path === 'TOKEN')).toHaveLength(1);
  });

  it('with no reader it parses process.env', () => {
    vi.stubEnv('CONFIG_SOURCE_VALUE', 'from-process');

    expect(loadEnv(z.object({ CONFIG_SOURCE_VALUE: z.string() })).CONFIG_SOURCE_VALUE).toBe(
      'from-process',
    );
  });

  it('unknown keys are stripped, not rejected', () => {
    expect(loadEnv(schema, { SERVICE: 'svc', EXTRA: 'ignored' })).not.toHaveProperty('EXTRA');
  });

  it('a coerced value is typed on the result', () => {
    const config = loadEnv(schema, { SERVICE: 'svc', PORT: '8080' });

    expect(config.PORT).toBe(8080);
    expectTypeOf(config.PORT).toEqualTypeOf<number>();
  });

  it('the result is the schema inferred type', () => {
    expectTypeOf(loadEnv(schema, { SERVICE: 'svc' })).toEqualTypeOf<z.infer<typeof schema>>();
  });
});
