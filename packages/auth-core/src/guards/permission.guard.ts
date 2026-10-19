import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthInvalidTokenError, AuthRoleForbiddenError, MissingRouteGuardError } from '../errors';
import type { PermissionCatalogue } from '../ports/permission-catalogue';
import { resolveRoutePolicy, type RoutePolicyTarget } from './route-metadata';
import type { ScopedRequest } from './scope.guard';
import { PERMISSION_CATALOGUE } from './tokens';

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    @Inject(PERMISSION_CATALOGUE) private readonly catalogue: PermissionCatalogue,
    @Inject(Reflector) private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const policy = resolveRoutePolicy(
      this.reflector,
      context.getHandler() as RoutePolicyTarget,
      context.getClass() as RoutePolicyTarget,
    );
    // Fail closed: a route that names none of the keys cannot be reached even if the guard is bound.
    if (policy === null) throw new MissingRouteGuardError();
    if (policy.kind !== 'permission') return true;

    const scope = context.switchToHttp().getRequest<ScopedRequest>().scope;
    if (scope === undefined) throw new AuthInvalidTokenError();

    const grants = await this.catalogue.grantsFor(scope.scope, scope.role);
    if (!grants.has(policy.permission)) throw new AuthRoleForbiddenError();

    return true;
  }
}
