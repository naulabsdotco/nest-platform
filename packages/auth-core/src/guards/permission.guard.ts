import { Inject, Injectable, Optional, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AUTH_CODES, PERMISSION_CATALOGUE, type AuthCodeMap } from '../di';
import { AUTH_ERROR_CODES, AuthInvalidTokenError, AuthRoleForbiddenError, MissingRouteGuardError } from '../errors';
import type { PermissionCatalogue } from '../ports/permission-catalogue';
import { resolveRoutePolicy, type RoutePolicyTarget } from './route-metadata';
import type { ScopedRequest } from './scope.guard';

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    @Inject(PERMISSION_CATALOGUE) private readonly catalogue: PermissionCatalogue,
    @Inject(Reflector) private readonly reflector: Reflector,
    @Optional() @Inject(AUTH_CODES) private readonly codes: AuthCodeMap = AUTH_ERROR_CODES,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const policy = resolveRoutePolicy(
      this.reflector,
      context.getHandler() as RoutePolicyTarget,
      context.getClass() as RoutePolicyTarget,
    );
    // Fail closed: a route that names none of the keys cannot be reached even if the guard is bound.
    if (policy === null) throw new MissingRouteGuardError(undefined, this.codes.INTERNAL_ERROR);
    if (policy.kind === 'public') return true;

    const request = context.switchToHttp().getRequest<ScopedRequest>();
    // Without a verified principal the JWT guard did not run; an authenticated route must not pass.
    if (policy.kind === 'authenticated') {
      if (request.principal?.sub === undefined) {
        throw new AuthInvalidTokenError(undefined, this.codes.AUTH_INVALID_TOKEN);
      }
      return true;
    }

    const scope = request.scope;
    if (scope === undefined) throw new AuthInvalidTokenError(undefined, this.codes.AUTH_INVALID_TOKEN);

    const grants = await this.catalogue.grantsFor(scope.scope, scope.role);
    if (!grants.has(policy.permission)) throw new AuthRoleForbiddenError(undefined, this.codes.AUTH_ROLE_FORBIDDEN);

    return true;
  }
}
