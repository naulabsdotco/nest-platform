import { Module, type INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { APP_CONFIG, createConfigModule } from './config.module';
import { ConfigValidationError } from './errors';

const schema = z.object({ SERVICE: z.string() });

const applications: INestApplicationContext[] = [];

afterEach(async () => {
  await Promise.all(applications.splice(0).map((application) => application.close()));
});

describe('createConfigModule', () => {
  it('APP_CONFIG is one process-wide token, not a per-copy symbol', () => {
    // A dual ESM/CJS install must resolve the same injection token from both copies.
    expect(Symbol.keyFor(APP_CONFIG as symbol)).toBe('@naulabsco/config/APP_CONFIG');
  });

  it('the module fails Nest bootstrap when APP_CONFIG cannot be built', async () => {
    @Module({ imports: [createConfigModule(schema, { raw: {} })] })
    class App {}

    await expect(
      NestFactory.createApplicationContext(App, { logger: false, abortOnError: false }),
    ).rejects.toThrow(ConfigValidationError);
  });

  it('the module provides APP_CONFIG globally', async () => {
    // Sibling imports no module, so APP_CONFIG resolves only if the config module is global.
    @Module({
      providers: [
        { provide: 'SIBLING_VALUE', useFactory: (value: unknown) => value, inject: [APP_CONFIG] },
      ],
    })
    class Sibling {}

    @Module({ imports: [createConfigModule(schema, { raw: { SERVICE: 'svc' } }), Sibling] })
    class App {}

    const application = await NestFactory.createApplicationContext(App, { logger: false });
    applications.push(application);

    expect(application.get('SIBLING_VALUE')).toEqual({ SERVICE: 'svc' });
  });
});
