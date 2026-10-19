import { Module, type DynamicModule, type Provider } from '@nestjs/common';
import { createPasswordVerifier, type PasswordVerifier } from './crypto/password-verifier';
import {
  AUTH_CODES,
  AUTH_OPTIONS,
  JWT_STRATEGY,
  PASSWORD_VERIFIER,
  PERMISSION_CATALOGUE,
  SCOPE_RESOLVER,
  TOKEN_SERVICE,
  resolveCodes,
  type AuthCodeMap,
} from './di';
import { AuthConfigError } from './errors';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { createJwtStrategy } from './guards/jwt-strategy.factory';
import { PermissionGuard } from './guards/permission.guard';
import { ScopeGuard } from './guards/scope.guard';
import type { AuthStore } from './ports/auth-store';
import type { Clock } from './ports/clock';
import type { PasswordPolicy } from './ports/password-policy';
import type { PermissionCatalogue } from './ports/permission-catalogue';
import type { ScopeResolver } from './ports/scope-resolver';
import { AuthService } from './tokens/auth.service';
import { RefreshService } from './tokens/refresh.service';
import { ResetService, type ResetLinkSink } from './tokens/reset.service';
import { createTokenService, type TokenConfig, type TokenService } from './tokens/token.service';

export interface AuthCoreOptions {
  store: AuthStore;
  scopeResolver: ScopeResolver;
  permissionCatalogue: PermissionCatalogue;
  clock: Clock;
  passwordPolicy: PasswordPolicy;
  resetLinkSink: ResetLinkSink;
  tokenConfig: TokenConfig;
  reuseGraceSeconds: number;
  refreshTtlSeconds: number;
  resetTtlMinutes: number;
  codes?: Partial<AuthCodeMap>;
}

// TypeScript catches a missing seam in a TS consumer; this catches one from JS or a spread, and
// refuses to boot rather than run with an undefined adapter.
const REQUIRED_SEAMS: ReadonlyArray<keyof AuthCoreOptions> = [
  'store',
  'scopeResolver',
  'permissionCatalogue',
  'clock',
  'passwordPolicy',
  'resetLinkSink',
  'tokenConfig',
  'reuseGraceSeconds',
  'refreshTtlSeconds',
  'resetTtlMinutes',
];

const assertPositive = (value: number, name: string): void => {
  if (!Number.isFinite(value) || value <= 0) throw new AuthConfigError({ invalid: name });
};

const assertSeams = (opts: AuthCoreOptions): void => {
  for (const seam of REQUIRED_SEAMS) {
    if (opts[seam] === undefined || opts[seam] === null) throw new AuthConfigError({ missing: seam });
  }
  // The zod schema bounds these; a hand-built options object must fail the same way at boot.
  assertPositive(opts.tokenConfig.accessTtlSeconds, 'tokenConfig.accessTtlSeconds');
  assertPositive(opts.refreshTtlSeconds, 'refreshTtlSeconds');
  assertPositive(opts.resetTtlMinutes, 'resetTtlMinutes');
  if (!Number.isFinite(opts.reuseGraceSeconds) || opts.reuseGraceSeconds < 0) {
    throw new AuthConfigError({ invalid: 'reuseGraceSeconds' });
  }
};

const providersFor = (opts: AuthCoreOptions): Provider[] => {
  const strategy = createJwtStrategy({
    keys: opts.tokenConfig.keys,
    activeKid: opts.tokenConfig.activeKid,
    issuer: opts.tokenConfig.issuer,
    audience: opts.tokenConfig.audience,
  });

  return [
    { provide: AUTH_OPTIONS, useValue: opts },
    { provide: AUTH_CODES, useValue: resolveCodes(opts.codes) },
    { provide: SCOPE_RESOLVER, useValue: opts.scopeResolver },
    { provide: PERMISSION_CATALOGUE, useValue: opts.permissionCatalogue },
    {
      provide: TOKEN_SERVICE,
      useFactory: (options: AuthCoreOptions): TokenService => createTokenService(options.tokenConfig),
      inject: [AUTH_OPTIONS],
    },
    { provide: PASSWORD_VERIFIER, useFactory: (): PasswordVerifier => createPasswordVerifier() },
    { provide: JWT_STRATEGY, useClass: strategy },
    {
      provide: RefreshService,
      useFactory: (options: AuthCoreOptions): RefreshService =>
        new RefreshService({
          store: options.store,
          clock: options.clock,
          reuseGraceSeconds: options.reuseGraceSeconds,
          refreshTtlSeconds: options.refreshTtlSeconds,
        }),
      inject: [AUTH_OPTIONS],
    },
    {
      provide: ResetService,
      useFactory: (options: AuthCoreOptions, verifier: PasswordVerifier): ResetService =>
        new ResetService({
          store: options.store,
          clock: options.clock,
          verifier,
          policy: options.passwordPolicy,
          sink: options.resetLinkSink,
          resetTtlMinutes: options.resetTtlMinutes,
        }),
      inject: [AUTH_OPTIONS, PASSWORD_VERIFIER],
    },
    {
      provide: AuthService,
      useFactory: (
        options: AuthCoreOptions,
        verifier: PasswordVerifier,
        tokens: TokenService,
        refresh: RefreshService,
      ): AuthService => new AuthService({ store: options.store, verifier, tokens, refresh }),
      inject: [AUTH_OPTIONS, PASSWORD_VERIFIER, TOKEN_SERVICE, RefreshService],
    },
    JwtAuthGuard,
    ScopeGuard,
    PermissionGuard,
  ];
};

@Module({})
export class AuthCoreModule {
  static forRoot(opts: AuthCoreOptions): DynamicModule {
    assertSeams(opts);

    return {
      module: AuthCoreModule,
      providers: providersFor(opts),
      exports: [
        AUTH_CODES,
        SCOPE_RESOLVER,
        PERMISSION_CATALOGUE,
        TOKEN_SERVICE,
        PASSWORD_VERIFIER,
        JWT_STRATEGY,
        RefreshService,
        ResetService,
        AuthService,
        JwtAuthGuard,
        ScopeGuard,
        PermissionGuard,
      ],
    };
  }
}
