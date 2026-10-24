export interface Principal {
  readonly sub: string;
}

export interface AuthScope {
  readonly subject: string;
  readonly scope: string;
  readonly role: string;
  // Required, not optional: a resolver that omits it cannot accidentally read as active.
  readonly active: boolean;
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

export interface NewSubjectScope {
  readonly scope: string;
  readonly role: string;
  // Defaults to true; the adapter writes the row the consumer's scope model needs.
  readonly active?: boolean;
}

export interface NewSubject {
  readonly email: string;
  readonly credential: { readonly algo: 'argon2id' | 'bcrypt'; readonly hash: string };
  readonly scopes: readonly NewSubjectScope[];
}

export interface AuthStore {
  findCredentialByEmail(email: string): Promise<StoredCredential | null>;
  findScopesByEmail(email: string): Promise<readonly AuthScope[]>;
  // Optional so every existing adapter still compiles: implement it when an invite, admin or seed
  // flow creates subjects, and write the subject, credential and scope rows in one transaction.
  // The package never calls it; a duplicate email or an unknown scope is refused with
  // AuthSubjectCreationFailedError.
  createSubject?(input: NewSubject): Promise<{ subjectId: string }>;
  replaceCredentialHash(subjectId: string, hash: string): Promise<void>;
  issueRefresh(input: RefreshInput): Promise<RefreshRecord>;
  findRefreshByHash(tokenHash: string): Promise<RefreshRecord | null>;
  // Must compare-and-set on `used_at IS NULL AND revoked_at IS NULL`; a used or revoked row returns false.
  markRefreshUsed(id: string): Promise<boolean>;
  revokeRefreshFamily(familyId: string): Promise<void>;
  revokeRefreshForSubjects(subjectIds: readonly string[]): Promise<void>;
  issueResetToken(input: ResetInput): Promise<ResetRecord>;
  findResetToken(tokenHash: string): Promise<ResetRecord | null>;
  consumeResetToken(id: string): Promise<boolean>;
  recordLoginAttempt(attempt: LoginAttempt): Promise<void>;
}
