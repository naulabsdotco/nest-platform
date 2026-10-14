import type { AuthScope } from './auth-store';

export interface ScopeResolver<TScope extends AuthScope = AuthScope> {
  resolve(sub: string): Promise<TScope | null>;
}
