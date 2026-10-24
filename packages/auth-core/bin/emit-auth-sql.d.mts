export interface AuthSqlTables {
  subject?: string;
  credential?: string;
  refreshToken?: string;
  resetToken?: string;
  loginAttempt?: string;
}

export interface AuthSqlShape {
  tables?: AuthSqlTables;
  columns?: {
    credential?: { sourceUpdatedAt?: boolean; failedCount?: boolean; lockedUntil?: boolean };
  };
  loginAttempt?: { partitioned?: { by: 'range'; column: string } };
}

export type AuthSqlDirection = 'up' | 'down' | 'both';
export type AuthSqlFileStatus = 'missing' | 'differs' | 'in-sync';

export interface AuthSqlCheck {
  readonly path: string;
  readonly status: AuthSqlFileStatus;
}

export interface EmitAuthSqlOptions extends AuthSqlShape {
  destDir: string;
  utc14: string;
  direction?: AuthSqlDirection;
  verify?: boolean;
  mode?: 'write';
}

export interface CheckAuthSqlOptions extends Omit<EmitAuthSqlOptions, 'mode'> {
  mode: 'check';
}

export function emitAuthSql(opts: CheckAuthSqlOptions): Promise<readonly AuthSqlCheck[]>;
export function emitAuthSql(opts: EmitAuthSqlOptions): Promise<readonly string[]>;
