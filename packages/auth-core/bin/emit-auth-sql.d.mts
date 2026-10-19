export interface EmitAuthSqlOptions {
  destDir: string;
  utc14: string;
}

export function emitAuthSql(opts: EmitAuthSqlOptions): Promise<readonly string[]>;
