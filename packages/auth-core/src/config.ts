import { z } from 'zod';

// 256 bits: an HS256 secret shorter than the digest adds nothing to the signature strength.
export const MIN_SECRET_LENGTH = 32;
// A long but low-diversity secret is still guessable, so strength is length *and* variety.
export const MIN_SECRET_DIVERSITY = 10;

export const isStrongSecret = (secret: string): boolean =>
  secret.length >= MIN_SECRET_LENGTH && new Set(secret).size >= MIN_SECRET_DIVERSITY;

// A kid that shadows an Object.prototype member would collide with a plain-object key map.
const RESERVED_KIDS = new Set(['__proto__', 'constructor', 'prototype']);

const kid = z.string().min(1).refine((value) => !RESERVED_KIDS.has(value), { message: 'a reserved key id' });

const secret = z.string().refine(isStrongSecret, {
  message: 'AUTH_JWT_KEYS values must be 256 bits of high-diversity random data (openssl rand -base64 32)',
});

const jwtKeys = z
  .string()
  .transform((raw, ctx) => {
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      // Never echo the raw value: it carries secrets and the message would reach a boot log.
      ctx.addIssue({ code: 'custom', message: 'AUTH_JWT_KEYS must be a JSON object of kid to secret' });
      return z.NEVER;
    }
  })
  .pipe(z.record(kid, secret));

export const authCoreConfigSchema = z
  .object({
    AUTH_JWT_ACTIVE_KID: z.string().min(1),
    AUTH_JWT_KEYS: jwtKeys,
    AUTH_ISSUER: z.string().trim().min(1),
    AUTH_AUDIENCE: z.string().trim().min(1),
    // Ceilings exist because an access token cannot be revoked and a huge reuse grace defeats rotation.
    AUTH_ACCESS_TTL: z.coerce.number().int().positive().max(3600).default(900),
    AUTH_REFRESH_TTL: z.coerce.number().int().positive().max(7_776_000).default(2_592_000),
    AUTH_RESET_TTL_MINUTES: z.coerce.number().int().positive().max(1440).default(20),
    AUTH_REFRESH_REUSE_GRACE_SECONDS: z.coerce.number().int().nonnegative().max(60).default(10),
  })
  .refine((config) => Object.hasOwn(config.AUTH_JWT_KEYS, config.AUTH_JWT_ACTIVE_KID), {
    message: 'AUTH_JWT_ACTIVE_KID is not present in AUTH_JWT_KEYS',
    path: ['AUTH_JWT_ACTIVE_KID'],
  });

export type AuthCoreConfig = z.infer<typeof authCoreConfigSchema>;
