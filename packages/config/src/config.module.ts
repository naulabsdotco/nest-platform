import { Global, Module, type DynamicModule, type InjectionToken } from '@nestjs/common';
import type { z } from 'zod';
import { loadEnv, type EnvReader } from './load-env';

export const APP_CONFIG: InjectionToken<unknown> = Symbol('APP_CONFIG');

@Global()
@Module({})
class ConfigModule {}

export function createConfigModule<T>(
  schema: z.ZodType<T>,
  opts?: { raw?: EnvReader },
): DynamicModule {
  return {
    module: ConfigModule,
    providers: [{ provide: APP_CONFIG, useFactory: () => loadEnv(schema, opts?.raw) }],
    exports: [APP_CONFIG],
  };
}
