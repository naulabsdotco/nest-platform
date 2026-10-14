// A credential that reaches a log line is a leak, so a consumer may append but never empty this list.
// pino wildcards match one level each: `*.password` a nested body, `*.*.password` a nested object.
export const DEFAULT_REDACT_PATHS: readonly string[] = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'req.headers["x-auth-token"]',
  'authorization',
  'password',
  'token',
  'credential',
  'secret',
  'apiKey',
  'req.body.password',
  'req.body.token',
  'req.body.credential',
  '*.password',
  '*.token',
  '*.credential',
  '*.secret',
  '*.*.password',
  '*.*.token',
  '*.*.credential',
  'params',
  '*.params',
];

export function resolveRedactPaths(extra: readonly string[] = []): string[] {
  return [...DEFAULT_REDACT_PATHS, ...extra];
}
