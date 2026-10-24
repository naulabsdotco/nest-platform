import { Module, type CanActivate, type DynamicModule, type INestApplicationContext, type Provider, type Type } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { createPasswordVerifier, type PasswordVerifier } from './crypto/password-verifier';
import {
  AUTH_CODES,
  AUTH_OPTIONS,
  DEFERRED_SEAMS,
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
import type { UnitOfWork } from './ports/unit-of-work';
import { AuthService } from './tokens/auth.service';
import { RefreshService } from './tokens/refresh.service';
import { ResetService, type ResetLinkSink } from './tokens/reset.service';
import { createTokenService, type TokenConfig, type TokenService } from './tokens/token.service';

export type GuardEntry = Type<CanActivate> | CanActivate;

export interface GuardPipeline {
  readonly afterAuth?: readonly GuardEntry[];
  readonly afterScope?: readonly GuardEntry[];
}

export type AdapterSeam =
  | 'store'
  | 'scopeResolver'
  | 'permissionCatalogue'
  | 'clock'
  | 'passwordPolicy'
  | 'resetLinkSink';

const ADAPTER_SEAMS: readonly AdapterSeam[] = [
  'store',
  'scopeResolver',
  'permissionCatalogue',
  'clock',
  'passwordPolicy',
  'resetLinkSink',
];

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
  unitOfWork?: UnitOfWork;
  guardPipeline?: GuardPipeline;
  // Adapter seams that may be absent at boot; the rest are still required.
  deferredSeams?: readonly AdapterSeam[];
}

// The adapter seams become optional only when the same call names them in `deferredSeams`, so a
// missing adapter still fails to compile unless the consumer says it is deliberate.
export type DeferredAuthCoreOptions = Omit<AuthCoreOptions, AdapterSeam | 'deferredSeams'> &
  Partial<Pick<AuthCoreOptions, AdapterSeam>> & { deferredSeams: readonly AdapterSeam[] };

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

// TypeScript rejects a third slot; this refuses one that arrives from JS or a spread, so the
// built-in relative order cannot be changed at runtime either.
const PIPELINE_SLOTS: ReadonlyArray<keyof GuardPipeline> = ['afterAuth', 'afterScope'];

const assertPipeline = (pipeline?: GuardPipeline): void => {
  if (pipeline === undefined) return;
  for (const key of Object.keys(pipeline)) {
    if (!PIPELINE_SLOTS.includes(key as keyof GuardPipeline)) {
      throw new AuthConfigError({ invalid: `guardPipeline.${key}` });
    }
  }
  for (const slot of PIPELINE_SLOTS) {
    const guards = pipeline[slot];
    const valid =
      guards === undefined ||
      (Array.isArray(guards) &&
        guards.every((guard) => typeof guard === 'function' || (typeof guard === 'object' && guard !== null)));
    if (!valid) throw new AuthConfigError({ invalid: `guardPipeline.${slot}` });
  }
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
  assertPipeline(opts.guardPipeline);
};

const guardProvider = (guard: GuardEntry): Provider =>
  // An instance is bound as-is: a class here would be resolved in this module's injector, which does
  // not see the consumer's providers.
  typeof guard === 'function' ? { provide: APP_GUARD, useClass: guard } : { provide: APP_GUARD, useValue: guard };

const deferSeam = (name: AdapterSeam): never =>
  new Proxy(
    {},
    {
      get: (_target, property) => {
        // A symbol probe is inspection, not use; only a named member is a seam call.
        if (typeof property === 'symbol') return undefined;
        return () => {
          throw new AuthConfigError({ missing: name });
        };
      },
    },
  ) as never;

// A deferred seam is only replaced when it is actually absent: a provided adapter always wins.
const resolveOptions = (
  opts: AuthCoreOptions | DeferredAuthCoreOptions,
): { resolved: AuthCoreOptions; deferred: AdapterSeam[] } => {
  const declared = opts.deferredSeams ?? [];
  for (const seam of declared) {
    if (!ADAPTER_SEAMS.includes(seam)) throw new AuthConfigError({ invalid: `deferredSeams.${String(seam)}` });
  }

  const resolved = { ...opts } as AuthCoreOptions;
  const deferred: AdapterSeam[] = [];
  for (const seam of declared) {
    if (resolved[seam] !== undefined && resolved[seam] !== null) continue;
    resolved[seam] = deferSeam(seam);
    deferred.push(seam);
  }
  assertSeams(resolved);
  return { resolved, deferred };
};

const providersFor = (opts: AuthCoreOptions, deferred: readonly AdapterSeam[]): Provider[] => {
  const strategy = createJwtStrategy({
    keys: opts.tokenConfig.keys,
    activeKid: opts.tokenConfig.activeKid,
    issuer: opts.tokenConfig.issuer,
    audience: opts.tokenConfig.audience,
  });

  return [
    { provide: AUTH_OPTIONS, useValue: opts },
    { provide: DEFERRED_SEAMS, useValue: [...deferred] },
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
          unitOfWork: options.unitOfWork,
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
    // Global registration in this order is the mechanism: a consumer cannot omit or misorder them.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    ...(opts.guardPipeline?.afterAuth ?? []).map(guardProvider),
    { provide: APP_GUARD, useClass: ScopeGuard },
    ...(opts.guardPipeline?.afterScope ?? []).map(guardProvider),
    { provide: APP_GUARD, useClass: PermissionGuard },
  ];
};

@Module({})
export class AuthCoreModule {
  static forRoot(opts: AuthCoreOptions): DynamicModule;
  static forRoot(opts: DeferredAuthCoreOptions): DynamicModule;
  static forRoot(opts: AuthCoreOptions | DeferredAuthCoreOptions): DynamicModule {
    const { resolved, deferred } = resolveOptions(opts);

    return {
      module: AuthCoreModule,
      providers: providersFor(resolved, deferred),
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

  // An explicit gate for an e2e test: a deferred seam boots, but the test can refuse to start.
  static assertSeamsReady(app: INestApplicationContext): void {
    const deferred = app.get<AdapterSeam[]>(DEFERRED_SEAMS, { strict: false });
    if (deferred.length > 0) throw new AuthConfigError({ deferred });
  }
}
