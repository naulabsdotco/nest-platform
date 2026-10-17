import { describe, expect, it } from 'vitest';
import { authCoreConfigSchema } from './config';

const secret = (): string => '0123456789abcdef'.repeat(2);

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

  it('a key secret shorter than 256 bits is rejected', () => {
    const result = authCoreConfigSchema.safeParse(environment({ AUTH_JWT_KEYS: JSON.stringify({ 'kid-1': 'abc' }) }));

    expect(result.success).toBe(false);
  });

  it('a low-diversity secret is rejected however long it is', () => {
    const result = authCoreConfigSchema.safeParse(environment({ AUTH_JWT_KEYS: JSON.stringify({ 'kid-1': 'k'.repeat(64) }) }));

    expect(result.success).toBe(false);
  });

  it('the issue text for a rejected secret never echoes the secret', () => {
    const guessable = 'changeitchangeitchangeitchangeit1';
    const result = authCoreConfigSchema.safeParse(environment({ AUTH_JWT_KEYS: JSON.stringify({ 'kid-1': guessable }) }));

    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).not.toContain(guessable);
  });

  it('an issuer or audience that is only whitespace is rejected', () => {
    expect(authCoreConfigSchema.safeParse(environment({ AUTH_ISSUER: '   ' })).success).toBe(false);
    expect(authCoreConfigSchema.safeParse(environment({ AUTH_AUDIENCE: ' ' })).success).toBe(false);
  });

  it('a TTL or reuse grace above its ceiling is rejected', () => {
    expect(authCoreConfigSchema.safeParse(environment({ AUTH_ACCESS_TTL: '31536000' })).success).toBe(false);
    expect(authCoreConfigSchema.safeParse(environment({ AUTH_REFRESH_REUSE_GRACE_SECONDS: '3600' })).success).toBe(false);
    expect(authCoreConfigSchema.safeParse(environment({ AUTH_RESET_TTL_MINUTES: '100000' })).success).toBe(false);
  });

  it('a reserved key id is rejected', () => {
    const raw = `{"__proto__":${JSON.stringify(secret())},"constructor":${JSON.stringify(secret())}}`;

    expect(authCoreConfigSchema.safeParse(environment({ AUTH_JWT_KEYS: raw })).success).toBe(false);
  });

  it('AUTH_JWT_KEYS that is not a JSON object of strings is rejected', () => {
    const result = authCoreConfigSchema.safeParse(environment({ AUTH_JWT_KEYS: 'not-json' }));

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).not.toContain('not-json');
  });
});
