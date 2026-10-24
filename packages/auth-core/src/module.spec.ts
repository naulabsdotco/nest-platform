import { createRequire } from 'node:module';
import { type CanActivate, type ExecutionContext, type INestApplicationContext, type Type } from '@nestjs/common';
import { ApplicationConfig, NestFactory } from '@nestjs/core';
import { afterEach, describe, expect, it } from 'vitest';
import * as barrel from './index';
import {
  AuthConfigError,
  AuthInvalidTokenError,
  AuthRoleForbiddenError,
  MissingRouteGuardError,
  type AuthError,
} from './errors';
import { JWT_STRATEGY, PASSWORD_VERIFIER, TOKEN_SERVICE } from './di';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { PermissionGuard } from './guards/permission.guard';
import { Public, RequirePermission } from './guards/route-metadata';
import { ScopeGuard } from './guards/scope.guard';
import { AuthCoreModule, type AuthCoreOptions } from './module';
import { AuthService } from './tokens/auth.service';
import { RefreshService } from './tokens/refresh.service';
import { ResetService } from './tokens/reset.service';
import type { TokenService } from './tokens/token.service';

const SECRET = '0123456789abcdef'.repeat(2);
const SCOPE = { subject: 'subject-1', scope: 'example-app', role: 'member', active: true };

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

class OpenController {
  @Public()
  open(): void {}
}

class PermissionController {
  @RequirePermission('thing:read')
  read(): void {}
}

class BareController {
  bare(): void {}
}

class FirstInsertedGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{ principal?: { sub: string }; firstGuardSaw?: string }>();
    request.firstGuardSaw = request.principal?.sub;
    inspected.push('afterAuth');
    return true;
  }
}

class SecondInsertedGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{ scope?: { scope: string }; secondGuardSaw?: string }>();
    request.secondGuardSaw = request.scope?.scope;
    inspected.push('afterScope');
    return true;
  }
}

const inspected: string[] = [];

interface Request {
  headers: Record<string, string>;
}

const routeContext = (request: Request, controller: Type<unknown>, handler: () => void): ExecutionContext =>
  ({
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => ({}) }),
    getHandler: () => handler,
    getClass: () => controller,
  }) as unknown as ExecutionContext;

const guardsOf = (app: INestApplicationContext): readonly CanActivate[] =>
  app.get(ApplicationConfig).getGlobalGuards();

const runGuards = async (app: INestApplicationContext, contextOfRoute: ExecutionContext): Promise<void> => {
  for (const guard of guardsOf(app)) {
    if (!(await guard.canActivate(contextOfRoute))) throw new Error('a guard denied');
  }
};

const bearer = (token: string): Request => ({ headers: { authorization: `Bearer ${token}` } });

const errorOf = async (run: () => Promise<unknown>): Promise<AuthError> => {
  try {
    await run();
  } catch (error) {
    return error as AuthError;
  }
  throw new Error('the call was expected to reject');
};

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

  it('registers JwtAuth, Scope and Permission globally, in that order', async () => {
    const app = await context();

    expect(guardsOf(app).map((guard) => guard.constructor.name)).toEqual([
      'JwtAuthGuard',
      'ScopeGuard',
      'PermissionGuard',
    ]);
  });

  it('binds inserted guards only in the afterAuth and afterScope slots', async () => {
    const app = await context({ guardPipeline: { afterAuth: [FirstInsertedGuard], afterScope: [SecondInsertedGuard] } });

    expect(guardsOf(app).map((guard) => guard.constructor.name)).toEqual([
      'JwtAuthGuard',
      'FirstInsertedGuard',
      'ScopeGuard',
      'SecondInsertedGuard',
      'PermissionGuard',
    ]);
  });

  it('an afterAuth guard runs after the JWT guard and before the scope guard', async () => {
    inspected.length = 0;
    const app = await context({
      scopeResolver: {
        resolve: async () => {
          inspected.push('scope');
          return SCOPE;
        },
      },
      permissionCatalogue: {
        grantsFor: async () => {
          inspected.push('permission');
          return new Set(['thing:read']);
        },
      },
      guardPipeline: { afterAuth: [FirstInsertedGuard] },
    });
    const token = app.get<TokenService>(TOKEN_SERVICE).issueAccess('subject-1').accessToken;
    const request: Request & { firstGuardSaw?: string } = bearer(token);

    await runGuards(app, routeContext(request, PermissionController, PermissionController.prototype.read));

    expect(inspected).toEqual(['afterAuth', 'scope', 'permission']);
    expect(request.firstGuardSaw).toBe('subject-1');
  });

  it('an afterAuth guard runs for a request the permission guard then denies', async () => {
    inspected.length = 0;
    const app = await context({ scopeResolver: { resolve: async () => SCOPE }, guardPipeline: { afterAuth: [FirstInsertedGuard] } });
    const token = app.get<TokenService>(TOKEN_SERVICE).issueAccess('subject-1').accessToken;

    await expect(
      runGuards(app, routeContext(bearer(token), PermissionController, PermissionController.prototype.read)),
    ).rejects.toBeInstanceOf(AuthRoleForbiddenError);
    expect(inspected).toEqual(['afterAuth']);
  });

  it('an afterScope guard sees the resolved scope and runs before the permission guard', async () => {
    inspected.length = 0;
    const app = await context({
      scopeResolver: {
        resolve: async () => {
          inspected.push('scope');
          return SCOPE;
        },
      },
      permissionCatalogue: {
        grantsFor: async () => {
          inspected.push('permission');
          return new Set(['thing:read']);
        },
      },
      guardPipeline: { afterScope: [SecondInsertedGuard] },
    });
    const token = app.get<TokenService>(TOKEN_SERVICE).issueAccess('subject-1').accessToken;
    const request: Request & { secondGuardSaw?: string } = bearer(token);

    await runGuards(app, routeContext(request, PermissionController, PermissionController.prototype.read));

    expect(inspected).toEqual(['scope', 'afterScope', 'permission']);
    expect(request.secondGuardSaw).toBe('example-app');
  });

  it('an empty pipeline keeps the built-in order', async () => {
    const app = await context({ guardPipeline: {} });

    expect(guardsOf(app).map((guard) => guard.constructor.name)).toEqual([
      'JwtAuthGuard',
      'ScopeGuard',
      'PermissionGuard',
    ]);
  });

  it('refuses a slot outside the two fixed positions or a non-array slot', () => {
    const invalid = [
      { beforeAuth: [FirstInsertedGuard] },
      { afterPermission: [FirstInsertedGuard] },
      { afterAuth: FirstInsertedGuard },
    ];

    for (const guardPipeline of invalid) {
      expect(() =>
        AuthCoreModule.forRoot(options({ guardPipeline } as unknown as Partial<AuthCoreOptions>)),
      ).toThrow(AuthConfigError);
    }
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

  it('denies a @RequirePermission route to a valid token without the grant', async () => {
    const app = await context({ scopeResolver: { resolve: async () => SCOPE } });
    const token = app.get<TokenService>(TOKEN_SERVICE).issueAccess('subject-1').accessToken;
    const route = routeContext(bearer(token), PermissionController, PermissionController.prototype.read);

    await expect(runGuards(app, route)).rejects.toBeInstanceOf(AuthRoleForbiddenError);
  });

  it('denies a route that carries no metadata', async () => {
    const app = await context({ scopeResolver: { resolve: async () => SCOPE } });
    const token = app.get<TokenService>(TOKEN_SERVICE).issueAccess('subject-1').accessToken;
    const route = routeContext(bearer(token), BareController, BareController.prototype.bare);

    await expect(runGuards(app, route)).rejects.toBeInstanceOf(MissingRouteGuardError);
  });

  it('allows a @Public route with no token', async () => {
    const app = await context();
    const route = routeContext({ headers: {} }, OpenController, OpenController.prototype.open);

    await expect(runGuards(app, route)).resolves.toBeUndefined();
  });

  it('does not reach the scope resolver when the token is invalid', async () => {
    let calls = 0;
    const app = await context({
      scopeResolver: {
        resolve: async () => {
          calls += 1;
          return SCOPE;
        },
      },
    });
    const route = routeContext({ headers: {} }, PermissionController, PermissionController.prototype.read);

    await expect(runGuards(app, route)).rejects.toBeInstanceOf(AuthInvalidTokenError);
    expect(calls).toBe(0);
  });

  it('does not reach the permission catalogue when the scope fails', async () => {
    let calls = 0;
    const app = await context({
      scopeResolver: { resolve: async () => null },
      permissionCatalogue: {
        grantsFor: async () => {
          calls += 1;
          return new Set<string>();
        },
      },
    });
    const token = app.get<TokenService>(TOKEN_SERVICE).issueAccess('subject-1').accessToken;
    const route = routeContext(bearer(token), PermissionController, PermissionController.prototype.read);

    await expect(runGuards(app, route)).rejects.toBeInstanceOf(AuthInvalidTokenError);
    expect(calls).toBe(0);
  });

  it('an overridden code map changes the thrown code without changing the class', async () => {
    const app = await context({ codes: { AUTH_INVALID_TOKEN: 'EXAMPLE_INVALID' } });
    app.get(JWT_STRATEGY);

    const route = routeContext({ headers: {} }, GuardedController, GuardedController.prototype.guarded);
    const error = await errorOf(() => app.get(JwtAuthGuard).canActivate(route));

    expect(error).toBeInstanceOf(AuthInvalidTokenError);
    expect(error.code).toBe('EXAMPLE_INVALID');
  });

  it('a deep import fails resolution', () => {
    const require = createRequire(import.meta.url);

    for (const deep of ['dist/esm/module.js', 'dist/cjs/di.js', 'src/di.ts', 'src/tokens/jwt-keys.ts']) {
      expect(() => require.resolve(`@naulabsco/auth-core/${deep}`)).toThrow();
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
