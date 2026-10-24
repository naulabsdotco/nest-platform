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

export interface EmitAuthSqlOptions extends AuthSqlShape {
  destDir: string;
  utc14: string;
}

export function emitAuthSql(opts: EmitAuthSqlOptions): Promise<readonly string[]>;
