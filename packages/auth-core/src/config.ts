import { z } from 'zod';

// 256 bits: an HS256 secret shorter than the digest adds nothing to the signature strength.
const MIN_SECRET_LENGTH = 32;

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
  .pipe(z.record(z.string().min(1), z.string().min(MIN_SECRET_LENGTH)));

export const authCoreConfigSchema = z
  .object({
    AUTH_JWT_ACTIVE_KID: z.string().min(1),
    AUTH_JWT_KEYS: jwtKeys,
    AUTH_ISSUER: z.string().min(1),
    AUTH_AUDIENCE: z.string().min(1),
    AUTH_ACCESS_TTL: z.coerce.number().int().positive().default(900),
    AUTH_REFRESH_TTL: z.coerce.number().int().positive().default(2_592_000),
    AUTH_RESET_TTL_MINUTES: z.coerce.number().int().positive().default(20),
    AUTH_REFRESH_REUSE_GRACE_SECONDS: z.coerce.number().int().nonnegative().default(10),
  })
  .refine((config) => config.AUTH_JWT_ACTIVE_KID in config.AUTH_JWT_KEYS, {
    message: 'AUTH_JWT_ACTIVE_KID is not present in AUTH_JWT_KEYS',
    path: ['AUTH_JWT_ACTIVE_KID'],
  });

export type AuthCoreConfig = z.infer<typeof authCoreConfigSchema>;
