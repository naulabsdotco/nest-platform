import { SetMetadata, type Type } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';

export const PUBLIC_KEY = 'auth:public';
export const AUTHENTICATED_KEY = 'auth:authenticated';
export const PERMISSION_KEY = 'auth:permission';

export type RoutePolicy =
  | { readonly kind: 'public' }
  | { readonly kind: 'authenticated' }
  | { readonly kind: 'permission'; readonly permission: string };

// A decorator target is a class or a method; `Function` is banned, and `object` is not readable.
export type RoutePolicyTarget = Type<unknown> | ((...args: never[]) => unknown);

export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(PUBLIC_KEY, true);

export const Authenticated = (): MethodDecorator & ClassDecorator => SetMetadata(AUTHENTICATED_KEY, true);

export const RequirePermission = (id: string): MethodDecorator & ClassDecorator => {
  if (typeof id !== 'string' || id.trim() === '') {
    // An empty id would read as "no requirement"; refuse it at declaration, not at request time.
    throw new TypeError('RequirePermission needs a non-empty permission id');
  }
  return SetMetadata(PERMISSION_KEY, id);
};

// The strictest key on one target wins, so two keys on it cannot relax each other.
export const routePolicyOf = (reflector: Reflector, target: RoutePolicyTarget): RoutePolicy | null => {
  const permission = reflector.get<unknown>(PERMISSION_KEY, target);
  if (typeof permission === 'string' && permission.length > 0) return { kind: 'permission', permission };
  if (reflector.get<unknown>(AUTHENTICATED_KEY, target) === true) return { kind: 'authenticated' };
  if (reflector.get<unknown>(PUBLIC_KEY, target) === true) return { kind: 'public' };
  return null;
};

// A handler's policy replaces its class's wholesale: a class `@Public` never relaxes a stricter handler.
export const resolveRoutePolicy = (
  reflector: Reflector,
  handler: RoutePolicyTarget,
  controller: RoutePolicyTarget,
): RoutePolicy | null => routePolicyOf(reflector, handler) ?? routePolicyOf(reflector, controller);
