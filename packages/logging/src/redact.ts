// A credential that reaches a log line is a leak, so a consumer may append but never empty this list.
export const DEFAULT_REDACT_PATHS: readonly string[] = [
  'req.headers.authorization',
  'req.headers.cookie',
  'password',
  'token',
  'credential',
  'req.body.password',
  'req.body.token',
  'req.body.credential',
  '*.password',
  '*.token',
  '*.credential',
  'params',
  '*.params',
];

export function resolveRedactPaths(extra: readonly string[] = []): string[] {
  return [...DEFAULT_REDACT_PATHS, ...extra];
}
