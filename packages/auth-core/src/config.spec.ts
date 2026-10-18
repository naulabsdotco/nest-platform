import { describe, expect, it } from 'vitest';
import { authCoreConfigSchema } from './config';

const secret = (): string => 'k'.repeat(32);

const environment = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  AUTH_JWT_ACTIVE_KID: 'kid-1',
  AUTH_JWT_KEYS: JSON.stringify({ 'kid-1': secret() }),
  AUTH_ISSUER: 'https://issuer.example',
  AUTH_AUDIENCE: 'example-audience',
  ...overrides,
});

describe('authCoreConfigSchema', () => {
  it('the schema parses a complete environment and defaults the TTLs', () => {
    const parsed = authCoreConfigSchema.parse(environment());

    expect(parsed.AUTH_JWT_KEYS).toEqual({ 'kid-1': secret() });
    expect(parsed.AUTH_ACCESS_TTL).toBe(900);
    expect(parsed.AUTH_REFRESH_TTL).toBe(2_592_000);
    expect(parsed.AUTH_RESET_TTL_MINUTES).toBe(20);
    expect(parsed.AUTH_REFRESH_REUSE_GRACE_SECONDS).toBe(10);
  });

  it('a provided TTL overrides the default and is coerced from the environment', () => {
    const parsed = authCoreConfigSchema.parse(environment({ AUTH_ACCESS_TTL: '120' }));

    expect(parsed.AUTH_ACCESS_TTL).toBe(120);
  });

  it('the refine fails when the active kid is absent from AUTH_JWT_KEYS', () => {
    const result = authCoreConfigSchema.safeParse(environment({ AUTH_JWT_ACTIVE_KID: 'kid-2' }));

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['AUTH_JWT_ACTIVE_KID']);
  });

  it('a short key secret is rejected', () => {
    const result = authCoreConfigSchema.safeParse(
      environment({ AUTH_JWT_KEYS: JSON.stringify({ 'kid-1': 'k'.repeat(31) }) }),
    );

    expect(result.success).toBe(false);
  });

  it('AUTH_JWT_KEYS that is not a JSON object of strings is rejected', () => {
    const result = authCoreConfigSchema.safeParse(environment({ AUTH_JWT_KEYS: 'not-json' }));

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).not.toContain('not-json');
  });
});
