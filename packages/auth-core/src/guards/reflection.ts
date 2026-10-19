import type { INestApplicationContext } from '@nestjs/common';
import { PATH_METADATA } from '@nestjs/common/constants';
import { MetadataScanner, ModulesContainer, Reflector } from '@nestjs/core';
import { MissingRouteGuardError } from '../errors';
import { resolveRoutePolicy, routePolicyOf, type RoutePolicyTarget } from './route-metadata';

interface Offender {
  readonly controller: string;
  readonly handler: string;
}

const isGuarded = (reflector: Reflector, handler: RoutePolicyTarget, controller: RoutePolicyTarget): boolean => {
  const handlerPolicy = routePolicyOf(reflector, handler);
  const classPolicy = routePolicyOf(reflector, controller);
  if (!handlerPolicy && !classPolicy) return false;
  // A class-level @Public must not relax a handler that asks for more: that mix is a bug, not a policy.
  if (classPolicy?.kind === 'public' && handlerPolicy !== null && handlerPolicy.kind !== 'public') return false;
  return resolveRoutePolicy(reflector, handler, controller) !== null;
};

export function assertEveryRouteGuarded(app: INestApplicationContext): void {
  const reflector = new Reflector();
  const scanner = new MetadataScanner();
  const modules = app.get(ModulesContainer, { strict: false });
  const offenders: Offender[] = [];

  for (const module of modules.values()) {
    for (const wrapper of module.controllers.values()) {
      const metatype = wrapper.metatype;
      if (!metatype) throw new MissingRouteGuardError({ controller: String(wrapper.name ?? '<uninspectable>') });

      const prototype = metatype.prototype as Record<string, unknown>;
      for (const method of scanner.getAllMethodNames(prototype)) {
        const handler = prototype[method] as (...args: never[]) => unknown;
        if (Reflect.getMetadata(PATH_METADATA, handler) === undefined) continue;
        if (!isGuarded(reflector, handler, metatype as RoutePolicyTarget)) offenders.push({ controller: metatype.name, handler: method });
      }
    }
  }

  if (offenders.length > 0) throw new MissingRouteGuardError(offenders);
}
