export interface Principal {
  readonly sub: string;
}

export interface AuthScope {
  readonly subject: string;
  readonly scope: string;
  readonly role: string;
}

export interface StoredCredential {
  readonly subjectId: string;
  readonly algo: 'argon2id' | 'bcrypt';
  readonly hash: string;
}

export interface RefreshRecord {
  readonly id: string;
  readonly familyId: string;
  readonly subjectId: string;
  readonly expiresAt: Date;
  readonly usedAt: Date | null;
  readonly revokedAt: Date | null;
}

export interface ResetRecord {
  readonly id: string;
  readonly subjectId: string;
  readonly expiresAt: Date;
  readonly consumedAt: Date | null;
}

export interface LoginAttempt {
  readonly emailHash: string;
  readonly ip: string;
  readonly outcome: string;
  readonly reason?: string;
}

export interface RefreshInput {
  readonly subjectId: string;
  readonly tokenHash: string;
  readonly familyId: string;
  readonly expiresAt: Date;
  readonly userAgent?: string;
  readonly ip?: string;
}

export interface ResetInput {
  readonly subjectId: string;
  readonly tokenHash: string;
  readonly expiresAt: Date;
  readonly requestedIp?: string;
}

export interface AuthStore {
  findCredentialByEmail(email: string): Promise<StoredCredential | null>;
  findScopesByEmail(email: string): Promise<readonly AuthScope[]>;
  replaceCredentialHash(subjectId: string, hash: string): Promise<void>;
  issueRefresh(input: RefreshInput): Promise<RefreshRecord>;
  findRefreshByHash(tokenHash: string): Promise<RefreshRecord | null>;
  markRefreshUsed(id: string): Promise<boolean>;
  revokeRefreshFamily(familyId: string): Promise<void>;
  revokeRefreshForSubjects(subjectIds: readonly string[]): Promise<void>;
  issueResetToken(input: ResetInput): Promise<ResetRecord>;
  findResetToken(tokenHash: string): Promise<ResetRecord | null>;
  consumeResetToken(id: string): Promise<boolean>;
  recordLoginAttempt(attempt: LoginAttempt): Promise<void>;
}
