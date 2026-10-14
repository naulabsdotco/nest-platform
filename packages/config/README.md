# @naulabs/config

Parse and validate the environment at boot. A bad environment stops the process,
and the error names the failing keys without echoing a value it read.

## Usage

```ts
import { Module } from '@nestjs/common';
import { createConfigModule } from '@naulabs/config';
import { z } from 'zod';

const schema = z.object({
  PORT: z.string().regex(/^\d+$/).transform(Number),
  REGION: z.string().min(1),
});

@Module({ imports: [createConfigModule(schema)] })
export class AppModule {}
```

The module is global and registers one `APP_CONFIG` token: call `createConfigModule`
once per application and compose one schema. The token is `InjectionToken<unknown>`,
so type the injected value yourself.

```ts
import { Inject } from '@nestjs/common';
import { APP_CONFIG } from '@naulabs/config';

constructor(
  @Inject(APP_CONFIG) private readonly config: { PORT: number; REGION: string },
) {}
```

## Guarantees

- The schema is the only source of shape; the package adds none.
- `loadEnv(schema, raw?)` parses `raw ?? process.env`, applies schema defaults and strips unknown keys.
- An invalid environment throws `ConfigValidationError` (`code: 'CONFIG_INVALID'`, failing key paths in
  `missing`, deduplicated; a root-level issue is `(root)`). Inside `createConfigModule` it throws while
  the DI graph is built, so Nest bootstrap fails rather than the first request. The message carries key
  paths only, never a value read.
- `missing` names every failing path, present-but-invalid keys included.

## Coercion

`z.coerce.number()` maps `''` to `0` and `z.coerce.boolean()` maps `'false'` to `true`, so an
unset-as-empty variable can boot silently. Prefer `z.string().regex(...).transform(Number)` or
`z.stringbool()` when an empty value must be rejected.
