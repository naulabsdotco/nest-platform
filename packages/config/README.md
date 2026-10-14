# @naulabs/config

Parse and validate the environment at boot. A bad environment stops the process,
and the error names the failing keys without echoing a value it read.

## Usage

```ts
import { Module } from '@nestjs/common';
import { createConfigModule } from '@naulabs/config';
import { z } from 'zod';

const schema = z.object({ PORT: z.coerce.number(), REGION: z.string() });

@Module({ imports: [createConfigModule(schema)] })
export class AppModule {}
```

The module is global: `@Inject(APP_CONFIG)` works anywhere without importing it.

## Guarantees

- The schema is the only source of shape; the package adds none.
- `loadEnv(schema, raw?)` parses `raw ?? process.env`, applies schema defaults and strips unknown keys.
- An invalid environment throws `ConfigValidationError` (`code: 'CONFIG_INVALID'`, failing key paths in
  `missing`). Inside `createConfigModule` it throws while the DI graph is built, so Nest bootstrap
  fails rather than the first request. The message carries key paths only, never a value read.
