import { Inject, Injectable, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { AuthInvalidTokenError } from '../errors';
import type { Principal } from '../ports/auth-store';
import { resolveRoutePolicy, type RoutePolicyTarget } from './route-metadata';

export interface PrincipalRequest {
  principal?: Principal;
}

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const handler = context.getHandler() as RoutePolicyTarget;
    const controller = context.getClass() as RoutePolicyTarget;
    if (resolveRoutePolicy(this.reflector, handler, controller)?.kind === 'public') return true;
    // AuthGuard is async; the Observable arm of CanActivate is never taken.
    return super.canActivate(context) as Promise<boolean>;
  }

  // The principal is stored under its own key so a route never reads `req.user` as if it were trusted.
  getAuthenticateOptions(): { property: string } {
    return { property: 'principal' };
  }

  handleRequest<TPrincipal>(err: unknown, user: TPrincipal): TPrincipal {
    if (err || !user) throw new AuthInvalidTokenError();
    return user;
  }
}
