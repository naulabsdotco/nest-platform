export class ConfigValidationError extends Error {
  readonly code = 'CONFIG_INVALID';

  constructor(readonly missing: readonly string[]) {
    super(`invalid environment: ${missing.join(', ')}`);
    this.name = 'ConfigValidationError';
  }
}
