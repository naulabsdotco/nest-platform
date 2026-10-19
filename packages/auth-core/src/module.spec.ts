import { createRequire } from 'node:module';
import { Module, type ExecutionContext, type INestApplicationContext, type Type } from '@nestjs/common';
import { APP_GUARD, NestFactory } from '@nestjs/core';
import { afterEach, describe, expect, it } from 'vitest';
import * as barrel from './index';
import { AuthConfigError, AuthInvalidTokenError, type AuthError } from './errors';
import { JWT_STRATEGY, PASSWORD_VERIFIER, TOKEN_SERVICE } from './di';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { PermissionGuard } from './guards/permission.guard';
import { ScopeGuard } from './guards/scope.guard';
import { AuthCoreModule, type AuthCoreOptions } from './module';
import { AuthService } from './tokens/auth.service';
import { RefreshService } from './tokens/refresh.service';
import { ResetService } from './tokens/reset.service';

const SECRET = '0123456789abcdef'.repeat(2);

const options = (overrides: Partial<AuthCoreOptions> = {}): AuthCoreOptions => ({
  store: {} as AuthCoreOptions['store'],
  scopeResolver: { resolve: async () => null },
  permissionCatalogue: { grantsFor: async () => new Set<string>() },
  clock: { now: () => new Date('2026-10-19T00:00:00.000Z') },
  passwordPolicy: { validate: () => undefined },
  resetLinkSink: { send: async () => undefined },
  tokenConfig: {
    keys: { 'kid-1': SECRET },
    activeKid: 'kid-1',
    issuer: 'https://issuer.example',
    audience: 'example-app',
    accessTtlSeconds: 900,
  },
  reuseGraceSeconds: 10,
  refreshTtlSeconds: 3600,
  resetTtlMinutes: 20,
  ...overrides,
});

const apps: INestApplicationContext[] = [];

const context = async (overrides: Partial<AuthCoreOptions> = {}): Promise<INestApplicationContext> => {
  const app = await NestFactory.createApplicationContext(AuthCoreModule.forRoot(options(overrides)), {
    logger: false,
    abortOnError: false,
  });
  apps.push(app);
  return app;
};

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

class GuardedController {
  guarded(): void {}
}

const guardedContext = (): ExecutionContext =>
  ({
    switchToHttp: () => ({ getRequest: () => ({ headers: {} }), getResponse: () => ({}) }),
    getHandler: () => GuardedController.prototype.guarded,
    getClass: () => GuardedController,
  }) as unknown as ExecutionContext;

const errorOf = async (run: () => Promise<unknown>): Promise<AuthError> => {
  try {
    await run();
  } catch (error) {
    return error as AuthError;
  }
  throw new Error('the call was expected to reject');
};

// A consumer imports forRoot and binds the guards itself, with useClass; the module's exported tokens
// must make that resolve in the consumer's module context.
@Module({
  imports: [AuthCoreModule.forRoot(options())],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: ScopeGuard },
    { provide: APP_GUARD, useClass: PermissionGuard },
  ],
})
class ConsumerModule {}

describe('AuthCoreModule.forRoot', () => {
  it('provides the services, the strategy and the three guards', async () => {
    const app = await context();

    expect(app.get(TOKEN_SERVICE)).toBeDefined();
    expect(app.get(PASSWORD_VERIFIER)).toBeDefined();
    expect(app.get(JWT_STRATEGY)).toBeDefined();
    expect(app.get(RefreshService)).toBeInstanceOf(RefreshService);
    expect(app.get(ResetService)).toBeInstanceOf(ResetService);
    expect(app.get(AuthService)).toBeInstanceOf(AuthService);
    expect(app.get(JwtAuthGuard)).toBeInstanceOf(JwtAuthGuard);
    expect(app.get(ScopeGuard)).toBeInstanceOf(ScopeGuard);
    expect(app.get(PermissionGuard)).toBeInstanceOf(PermissionGuard);
  });

  it('provides the guards in the order JwtAuth, Scope, Permission', () => {
    const guards: readonly Type<unknown>[] = [JwtAuthGuard, ScopeGuard, PermissionGuard];
    const provided = (AuthCoreModule.forRoot(options()).providers ?? [])
      .filter((provider): provider is Type<unknown> => typeof provider === 'function' && guards.includes(provider))
      .map((provider) => provider.name);

    expect(provided).toEqual(['JwtAuthGuard', 'ScopeGuard', 'PermissionGuard']);
  });

  it('requires every seam, with no optional store, resolver or catalogue', () => {
    for (const seam of [
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
    ] as const) {
      const missing = { ...options(), [seam]: undefined } as unknown as AuthCoreOptions;
      expect(() => AuthCoreModule.forRoot(missing)).toThrow(AuthConfigError);
    }
  });

  it('rejects a non-positive TTL or a negative grace at boot', () => {
    const invalid: Array<Partial<AuthCoreOptions>> = [
      { refreshTtlSeconds: 0 },
      { refreshTtlSeconds: -1 },
      { resetTtlMinutes: 0 },
      { reuseGraceSeconds: -1 },
      { tokenConfig: { ...options().tokenConfig, accessTtlSeconds: 0 } },
    ];

    for (const override of invalid) {
      expect(() => AuthCoreModule.forRoot(options(override))).toThrow(AuthConfigError);
    }
  });

  it('a consumer module can register the guards with APP_GUARD useClass', async () => {
    const app = await NestFactory.createApplicationContext(ConsumerModule, { logger: false, abortOnError: false });
    apps.push(app);

    expect(app.get(JwtAuthGuard)).toBeInstanceOf(JwtAuthGuard);
    expect(app.get(ScopeGuard)).toBeInstanceOf(ScopeGuard);
    expect(app.get(PermissionGuard)).toBeInstanceOf(PermissionGuard);
  });

  it('an overridden code map changes the thrown code without changing the class', async () => {
    const app = await context({ codes: { AUTH_INVALID_TOKEN: 'EXAMPLE_INVALID' } });
    app.get(JWT_STRATEGY);

    const error = await errorOf(() => app.get(JwtAuthGuard).canActivate(guardedContext()));

    expect(error).toBeInstanceOf(AuthInvalidTokenError);
    expect(error.code).toBe('EXAMPLE_INVALID');
  });

  it('a deep import fails resolution', () => {
    const require = createRequire(import.meta.url);

    for (const deep of ['dist/esm/module.js', 'dist/cjs/di.js', 'src/di.ts', 'src/tokens/jwt-keys.ts']) {
      expect(() => require.resolve(`@naulabs/auth-core/${deep}`)).toThrow();
    }
  });

  it('the barrel exposes no internal token or helper', () => {
    expect(barrel).not.toHaveProperty('AUTH_CODES');
    expect(barrel).not.toHaveProperty('AUTH_OPTIONS');
    expect(barrel).not.toHaveProperty('JWT_STRATEGY');
    expect(barrel).not.toHaveProperty('SCOPE_RESOLVER');
    expect(barrel).not.toHaveProperty('PERMISSION_CATALOGUE');
    expect(barrel).not.toHaveProperty('keyByKid');
  });
});
