import { Controller, Get, Module, type INestApplicationContext, type Type } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { describe, expect, it } from 'vitest';
import { MissingRouteGuardError } from '../errors';
import { assertEveryRouteGuarded } from './reflection';
import { Authenticated, Public, RequirePermission } from './route-metadata';

@Controller('unannotated')
class UnannotatedController {
  @Get()
  list(): void {}

  @Get('other')
  other(): void {}
}

@Controller('annotated')
class AnnotatedController {
  @Public()
  @Get('open')
  open(): void {}

  @Authenticated()
  @Get()
  list(): void {}

  @RequirePermission('thing:read')
  @Get('read')
  read(): void {}
}

@Controller('public-only')
class PublicOnlyController {
  @Public()
  @Get()
  open(): void {}
}

@Authenticated()
@Controller('class-guarded')
class ClassGuardedController {
  @Get()
  list(): void {}
}

@RequirePermission('thing:read')
@Controller('class-permitted')
class ClassPermittedController {
  @Get()
  list(): void {}
}

@Public()
@Controller('class-public-handler-locked')
class ClassPublicHandlerLockedController {
  @RequirePermission('thing:write')
  @Get()
  write(): void {}
}

@Public()
@Controller('class-public-handler-authenticated')
class ClassPublicHandlerAuthenticatedController {
  @Authenticated()
  @Get()
  member(): void {}
}

class BaseController {
  @Get('inherited')
  inheritedRoute(): void {}
}

@Controller('inherited')
class InheritedController extends BaseController {
  @Public()
  @Get()
  open(): void {}
}

@Controller('with-helper')
class WithHelperController {
  @Public()
  @Get()
  open(): void {}

  helper(): string {
    return 'not a route';
  }
}

const withApp = async (
  controllers: Type<unknown>[],
  run: (app: INestApplicationContext) => void,
): Promise<void> => {
  @Module({ controllers })
  class TestModule {}

  const app = await NestFactory.createApplicationContext(TestModule, { logger: false });
  try {
    run(app);
  } finally {
    await app.close();
  }
};

const offender = async (controllers: Type<unknown>[]): Promise<unknown> => {
  let thrown: unknown;
  await withApp(controllers, (app) => {
    try {
      assertEveryRouteGuarded(app);
    } catch (error) {
      thrown = error;
    }
  });
  return thrown;
};

describe('assertEveryRouteGuarded', () => {
  it('an unannotated controller fails reflection and names every unguarded route', async () => {
    const thrown = await offender([UnannotatedController]);

    expect(thrown).toBeInstanceOf(MissingRouteGuardError);
    expect((thrown as MissingRouteGuardError).criteria).toEqual([
      { controller: 'UnannotatedController', handler: 'list' },
      { controller: 'UnannotatedController', handler: 'other' },
    ]);
  });

  it('a fully annotated controller passes', async () => {
    expect(await offender([AnnotatedController])).toBeUndefined();
  });

  it('a @Public handler in an unannotated controller passes', async () => {
    expect(await offender([PublicOnlyController])).toBeUndefined();
  });

  it('a class-level @Authenticated controller passes', async () => {
    expect(await offender([ClassGuardedController])).toBeUndefined();
  });

  it('a class-level @RequirePermission controller passes', async () => {
    expect(await offender([ClassPermittedController])).toBeUndefined();
  });

  it('a class-level @Public with a handler @RequirePermission fails', async () => {
    expect(await offender([ClassPublicHandlerLockedController])).toBeInstanceOf(MissingRouteGuardError);
  });

  it('a class-level @Public with a handler @Authenticated fails', async () => {
    expect(await offender([ClassPublicHandlerAuthenticatedController])).toBeInstanceOf(MissingRouteGuardError);
  });

  it('an inherited unannotated route fails', async () => {
    const thrown = await offender([InheritedController]);

    expect(thrown).toBeInstanceOf(MissingRouteGuardError);
    expect((thrown as MissingRouteGuardError).criteria).toEqual([
      { controller: 'InheritedController', handler: 'inheritedRoute' },
    ]);
  });

  it('a non-route helper method is skipped', async () => {
    expect(await offender([WithHelperController])).toBeUndefined();
  });
});
