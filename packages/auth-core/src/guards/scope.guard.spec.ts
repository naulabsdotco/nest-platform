import { type ExecutionContext, type Type } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it } from 'vitest';
import { AuthInvalidTokenError, AuthUserInactiveError } from '../errors';
import type { AuthScope } from '../ports/auth-store';
import type { ScopeResolver } from '../ports/scope-resolver';
import { Authenticated, Public } from './route-metadata';
import { ScopeGuard } from './scope.guard';

const ACTIVE: AuthScope = { subject: 'subject-1', scope: 'example-app', role: 'member', active: true };
const INACTIVE: AuthScope = { ...ACTIVE, active: false };

class OpenController {
  @Public()
  open(): void {}
}

class MemberController {
  @Authenticated()
  member(): void {}
}

interface Request {
  principal?: { sub?: string; scope?: string };
  scope?: AuthScope;
}

const contextFor = (request: Request, controller: Type<unknown>, handler: () => void): ExecutionContext =>
  ({
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => ({}) }),
    getHandler: () => handler,
    getClass: () => controller,
  }) as unknown as ExecutionContext;

const resolveTo = (scope: AuthScope | null): ScopeResolver => ({ resolve: async () => scope });

const guardWith = (resolver: ScopeResolver): ScopeGuard => new ScopeGuard(resolver, new Reflector());

const memberContext = (request: Request): ExecutionContext =>
  contextFor(request, MemberController, MemberController.prototype.member);

describe('ScopeGuard', () => {
  it("writes the resolver's scope to the request", async () => {
    const request: Request = { principal: { sub: 'subject-1' } };

    await expect(guardWith(resolveTo(ACTIVE)).canActivate(memberContext(request))).resolves.toBe(true);
    expect(request.scope).toEqual(ACTIVE);
  });

  it('refuses a subject with no scope row', async () => {
    const request: Request = { principal: { sub: 'subject-1' } };

    await expect(guardWith(resolveTo(null)).canActivate(memberContext(request))).rejects.toBeInstanceOf(
      AuthInvalidTokenError,
    );
  });

  it('refuses an inactive scope with a 403', async () => {
    const request: Request = { principal: { sub: 'subject-1' } };

    await expect(guardWith(resolveTo(INACTIVE)).canActivate(memberContext(request))).rejects.toBeInstanceOf(
      AuthUserInactiveError,
    );
  });

  it('refuses a request with no verified principal', async () => {
    await expect(guardWith(resolveTo(ACTIVE)).canActivate(memberContext({}))).rejects.toBeInstanceOf(
      AuthInvalidTokenError,
    );
  });

  it('a scope in the token payload cannot override the resolver', async () => {
    const request: Request = {
      principal: { sub: 'subject-1', scope: 'other-app' },
      scope: { subject: 'subject-1', scope: 'other-app', role: 'admin', active: true },
    };

    await guardWith(resolveTo(ACTIVE)).canActivate(memberContext(request));

    expect(request.scope).toEqual(ACTIVE);
  });

  it('a @Public route is not resolved', async () => {
    let calls = 0;
    const resolver: ScopeResolver = {
      resolve: async () => {
        calls += 1;
        return ACTIVE;
      },
    };

    await expect(
      guardWith(resolver).canActivate(contextFor({}, OpenController, OpenController.prototype.open)),
    ).resolves.toBe(true);
    expect(calls).toBe(0);
  });
});
