import { type ExecutionContext, type Type } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it } from 'vitest';
import { AuthRoleForbiddenError, MissingRouteGuardError } from '../errors';
import type { AuthScope } from '../ports/auth-store';
import type { PermissionCatalogue } from '../ports/permission-catalogue';
import type { ScopeResolver } from '../ports/scope-resolver';
import { Authenticated, Public, RequirePermission } from './route-metadata';
import { PermissionGuard } from './permission.guard';
import { ScopeGuard } from './scope.guard';

const SCOPE: AuthScope = { subject: 'subject-1', scope: 'example-app', role: 'member', active: true };

class OpenController {
  @Public()
  open(): void {}
}

class MemberController {
  @Authenticated()
  member(): void {}
}

class PermissionController {
  @RequirePermission('thing:read')
  read(): void {}
}

class BareController {
  bare(): void {}
}

class CountingCatalogue implements PermissionCatalogue {
  readonly calls: Array<readonly [string, string]> = [];

  constructor(private readonly grants: readonly string[]) {}

  async grantsFor(scope: string, role: string): Promise<ReadonlySet<string>> {
    this.calls.push([scope, role]);
    return new Set(this.grants);
  }
}

interface Request {
  principal?: { sub: string };
  scope?: AuthScope;
}

const contextFor = (request: Request, controller: Type<unknown>, handler: () => void): ExecutionContext =>
  ({
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => ({}) }),
    getHandler: () => handler,
    getClass: () => controller,
  }) as unknown as ExecutionContext;

const readContext = (request: Request): ExecutionContext =>
  contextFor(request, PermissionController, PermissionController.prototype.read);

const guardWith = (grants: readonly string[]): { guard: PermissionGuard; catalogue: CountingCatalogue } => {
  const catalogue = new CountingCatalogue(grants);
  return { guard: new PermissionGuard(catalogue, new Reflector()), catalogue };
};

describe('PermissionGuard', () => {
  it('refuses @RequirePermission without the grant', async () => {
    const { guard } = guardWith([]);

    await expect(guard.canActivate(readContext({ scope: SCOPE }))).rejects.toBeInstanceOf(AuthRoleForbiddenError);
  });

  it('allows @Authenticated without reading the catalogue', async () => {
    const { guard, catalogue } = guardWith([]);
    const request: Request = { scope: SCOPE };

    await expect(
      guard.canActivate(contextFor(request, MemberController, MemberController.prototype.member)),
    ).resolves.toBe(true);
    expect(catalogue.calls).toEqual([]);
  });

  it('a grant held for another scope does not satisfy the guard', async () => {
    const { guard } = guardWith(['thing:write']);

    await expect(guard.canActivate(readContext({ scope: SCOPE }))).rejects.toBeInstanceOf(AuthRoleForbiddenError);
  });

  it('allows @RequirePermission when the catalogue grants it', async () => {
    const { guard } = guardWith(['thing:read']);

    await expect(guard.canActivate(readContext({ scope: SCOPE }))).resolves.toBe(true);
  });

  it('a route with none of the three decorators throws MissingRouteGuardError', async () => {
    const { guard } = guardWith([]);

    await expect(
      guard.canActivate(contextFor({ scope: SCOPE }, BareController, BareController.prototype.bare)),
    ).rejects.toBeInstanceOf(MissingRouteGuardError);
  });

  it('@Public is allowed without reading the catalogue', async () => {
    const { guard, catalogue } = guardWith([]);

    await expect(
      guard.canActivate(contextFor({}, OpenController, OpenController.prototype.open)),
    ).resolves.toBe(true);
    expect(catalogue.calls).toEqual([]);
  });

  it('grants are read once per request, for the resolved scope and role', async () => {
    const { guard, catalogue } = guardWith(['thing:read']);

    await guard.canActivate(readContext({ scope: SCOPE }));

    expect(catalogue.calls).toEqual([['example-app', 'member']]);
  });

  it("reads the scope the ScopeGuard wrote to the request", async () => {
    const request: Request = { principal: { sub: 'subject-1' } };
    const resolver: ScopeResolver = { resolve: async () => SCOPE };
    const { guard, catalogue } = guardWith(['thing:read']);

    await new ScopeGuard(resolver, new Reflector()).canActivate(readContext(request));
    await expect(guard.canActivate(readContext(request))).resolves.toBe(true);
    expect(catalogue.calls).toEqual([['example-app', 'member']]);
  });
});
