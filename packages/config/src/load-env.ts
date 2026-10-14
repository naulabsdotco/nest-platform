import type { z } from 'zod';
import { ConfigValidationError } from './errors';

export type EnvReader = Record<string, string | undefined>;

export function loadEnv<T>(schema: z.ZodType<T>, raw?: EnvReader): T {
  const parsed = schema.safeParse(raw ?? process.env);

  if (!parsed.success) {
    throw new ConfigValidationError(parsed.error.issues.map((issue) => issue.path.join('.')));
  }

  return parsed.data;
}
