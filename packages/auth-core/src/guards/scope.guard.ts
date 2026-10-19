import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthInvalidTokenError, AuthUserInactiveError } from '../errors';
import type { AuthScope } from '../ports/auth-store';
import type { ScopeResolver } from '../ports/scope-resolver';
import type { PrincipalRequest } from './jwt-auth.guard';
import { resolveRoutePolicy, type RoutePolicyTarget } from './route-metadata';
import { SCOPE_RESOLVER } from './tokens';

export interface ScopedRequest<TScope extends AuthScope = AuthScope> extends PrincipalRequest {
  scope?: TScope;
}

@Injectable()
export class ScopeGuard<TScope extends AuthScope = AuthScope> implements CanActivate {
  constructor(
    @Inject(SCOPE_RESOLVER) private readonly resolver: ScopeResolver<TScope>,
    @Inject(Reflector) private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const policy = resolveRoutePolicy(
      this.reflector,
      context.getHandler() as RoutePolicyTarget,
      context.getClass() as RoutePolicyTarget,
    );
    if (policy?.kind === 'public') return true;

    const request = context.switchToHttp().getRequest<ScopedRequest<TScope>>();
    const sub = request.principal?.sub;
    if (typeof sub !== 'string' || sub.length === 0) throw new AuthInvalidTokenError();

    const scope = await this.resolver.resolve(sub);
    if (scope === null) throw new AuthInvalidTokenError();
    if (!scope.active) throw new AuthUserInactiveError();

    request.scope = scope;
    return true;
  }
}
