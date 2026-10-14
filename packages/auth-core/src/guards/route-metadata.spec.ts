import { Controller, Get } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it } from 'vitest';
import {
  AUTHENTICATED_KEY,
  Authenticated,
  PERMISSION_KEY,
  PUBLIC_KEY,
  Public,
  RequirePermission,
  resolveRoutePolicy,
  routePolicyOf,
} from './route-metadata';

@Controller('open')
class OpenController {
  @Public()
  @Get()
  handler(): void {}
}

@Controller('guarded')
class GuardedController {
  @Authenticated()
  @Get()
  member(): void {}
}

@Controller('permitted')
@RequirePermission('thing:all')
class PermittedController {
  @RequirePermission('thing:read')
  @Get()
  read(): void {}

  @Get('all')
  all(): void {}
}

@Public()
@Controller('locked-down')
class PublicClassController {
  @RequirePermission('thing:write')
  @Get()
  write(): void {}

  @Authenticated()
  @Get('member')
  member(): void {}
}

@Authenticated()
@Controller('opened-up')
class AuthenticatedClassController {
  @Public()
  @Get()
  open(): void {}
}

const reflector = new Reflector();

describe('route metadata', () => {
  it('Public marks a handler and the reflector reads the key', () => {
    expect(reflector.get<boolean>(PUBLIC_KEY, OpenController.prototype.handler)).toBe(true);
  });

  it('Authenticated marks a handler and the reflector reads the key', () => {
    expect(reflector.get<boolean>(AUTHENTICATED_KEY, GuardedController.prototype.member)).toBe(true);
  });

  it('RequirePermission stores the permission id', () => {
    expect(reflector.get<string>(PERMISSION_KEY, PermittedController.prototype.read)).toBe('thing:read');
  });

  it('RequirePermission refuses an empty permission id at declaration time', () => {
    expect(() => RequirePermission('')).toThrow(TypeError);
    expect(() => RequirePermission('   ')).toThrow(TypeError);
  });

  it('class-level and handler-level metadata combine with the handler winning', () => {
    expect(routePolicyOf(reflector, PermittedController.prototype.read)).toEqual({
      kind: 'permission',
      permission: 'thing:read',
    });
    expect(routePolicyOf(reflector, PermittedController)).toEqual({ kind: 'permission', permission: 'thing:all' });
    expect(resolveRoutePolicy(reflector, PermittedController.prototype.all, PermittedController)).toEqual({
      kind: 'permission',
      permission: 'thing:all',
    });
  });

  it('a class-level @Public never relaxes a stricter handler', () => {
    expect(resolveRoutePolicy(reflector, PublicClassController.prototype.write, PublicClassController)).toEqual({
      kind: 'permission',
      permission: 'thing:write',
    });
    expect(resolveRoutePolicy(reflector, PublicClassController.prototype.member, PublicClassController)).toEqual({
      kind: 'authenticated',
    });
  });

  it('a handler-level @Public opens a route under a stricter class', () => {
    expect(resolveRoutePolicy(reflector, AuthenticatedClassController.prototype.open, AuthenticatedClassController)).toEqual({
      kind: 'public',
    });
  });
});
