import type { z } from 'zod';
import { ConfigValidationError } from './errors';

export type EnvReader = Record<string, string | undefined>;

const ROOT = '(root)';

export function loadEnv<T>(schema: z.ZodType<T>, raw?: EnvReader): T {
  const parsed = schema.safeParse(raw ?? process.env);

  if (!parsed.success) {
    // Path keys are strings, numbers or symbols; an empty path is a root-level issue.
    const paths = parsed.error.issues.map((issue) => issue.path.map(String).join('.') || ROOT);
    throw new ConfigValidationError([...new Set(paths)]);
  }

  return parsed.data;
}
