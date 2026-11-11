import type { ExecutionContext } from '@nestjs/common';
import { KafkaContext, NatsContext, RmqContext, TcpContext } from '@nestjs/microservices';
import { PARAMS_PROVIDER_TOKEN, PINO_PRE_REQUEST_HOOK, PinoLogger, type Params } from 'nestjs-pino';
import { beforeEach, describe, expect, expectTypeOf, it } from 'vitest';
import { createLoggerModule, type LoggerOptions, type MicroserviceLoggerOptions } from './logger.module';

const UUID_ONE = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const UUID_TWO = '9c858901-8a57-4791-81fe-4c455b099bc9';
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

interface Observer {
  next(value: unknown): void;
  error(error: unknown): void;
  complete(): void;
}

type Hook = (context: ExecutionContext, next: () => unknown) => { subscribe(observer: Observer): unknown };

const lines: string[] = [];
const options: LoggerOptions = {
  service: 'example-app',
  microservice: true,
  destination: { write: (line: string) => void lines.push(line) },
};

const providers = (createLoggerModule(options).providers ?? []) as Array<{
  provide?: unknown;
  useValue?: Params;
  useFactory?: (params: Params) => Hook;
}>;

const params = providers.find((provider) => provider.provide === PARAMS_PROVIDER_TOKEN)?.useValue;
if (!params) throw new Error('the module provides no pino params');

const hook = providers.find((provider) => provider.provide === PINO_PRE_REQUEST_HOOK)?.useFactory?.(params);
if (!hook) throw new Error('the module registers no microservice hook');

const kafka = (headers: Record<string, unknown>): KafkaContext =>
  new KafkaContext([{ headers } as never, 0, 'example', {} as never, async () => {}, {} as never]);

const rmq = (headers: Record<string, unknown>): RmqContext =>
  new RmqContext([{ properties: { headers } } as never, {} as never, 'example']);

const natsHeaders = (entries: Record<string, string>) => ({
  keys: () => Object.keys(entries),
  get: (name: string) => (entries[name] === undefined ? undefined : [entries[name]]),
});

const contextOf = (context: unknown, data: unknown = {}): ExecutionContext =>
  ({ getType: () => 'rpc', switchToRpc: () => ({ getContext: () => context, getData: () => data }) }) as unknown as
    ExecutionContext;

const deliverWith = (
  hook: Hook,
  context: unknown,
  handle: (logger: PinoLogger) => void | Promise<void>,
  data: unknown = {},
): Promise<void> => {
  const logger = new PinoLogger(params);
  const source = {
    subscribe(observer: Observer) {
      void (async () => {
        try {
          await handle(logger);
          observer.next(undefined);
          observer.complete();
        } catch (error) {
          observer.error(error);
        }
      })();
      return { unsubscribe() {} };
    },
  };
  return new Promise((resolve, reject) => {
    hook(contextOf(context, data), () => source).subscribe({ next: () => {}, error: reject, complete: resolve });
  });
};

const deliver = (context: unknown, handle: (logger: PinoLogger) => void | Promise<void>): Promise<void> =>
  deliverWith(hook, context, handle);

const emitted = (): Record<string, unknown>[] => lines.map((line) => JSON.parse(line) as Record<string, unknown>);
const lineWith = (message: string): Record<string, unknown> =>
  emitted().find((line) => line.msg === message) as Record<string, unknown>;

beforeEach(() => {
  lines.length = 0;
});

describe('microservice logging', () => {
  it("carries an inbound UUID from a Kafka message's headers", async () => {
    await deliver(kafka({ 'x-correlation-id': Buffer.from(UUID_ONE) }), (logger) =>
      logger.info({ event: 'example.run' }, 'handled'),
    );

    expect(lineWith('handled').correlationId).toBe(UUID_ONE);
    expect(lineWith('message completed').correlationId).toBe(UUID_ONE);
  });

  it("carries an inbound UUID from an AMQP message's properties.headers", async () => {
    await deliver(rmq({ 'x-correlation-id': UUID_ONE }), (logger) =>
      logger.info({ event: 'example.run' }, 'handled'),
    );

    expect(lineWith('handled').correlationId).toBe(UUID_ONE);
  });

  it("carries an inbound UUID from a NATS message's getHeaders() map", async () => {
    await deliver(new NatsContext(['example', natsHeaders({ 'x-correlation-id': UUID_ONE })]), (logger) =>
      logger.info({ event: 'example.run' }, 'handled'),
    );

    expect(lineWith('handled').correlationId).toBe(UUID_ONE);
  });

  it('matches a NATS header regardless of the case the producer used', async () => {
    await deliver(new NatsContext(['example', natsHeaders({ 'X-Correlation-Id': UUID_ONE })]), (logger) =>
      logger.info({ event: 'example.run' }, 'handled'),
    );

    expect(lineWith('handled').correlationId).toBe(UUID_ONE);
  });

  it('generates a UUID for a transport that carries no headers', async () => {
    await deliver(new TcpContext([{} as never, 'example']), (logger) =>
      logger.info({ event: 'example.run' }, 'handled'),
    );

    expect(lineWith('handled').correlationId).toMatch(UUID_V4);
  });

  it('replaces a non-canonical inbound id and never logs it raw', async () => {
    const rejected = 'not-a-uuid\ninjected';

    await deliver(kafka({ 'x-correlation-id': rejected }), (logger) =>
      logger.info({ event: 'example.run' }, 'handled'),
    );

    expect(lineWith('handled').correlationId).toMatch(UUID_V4);
    expect(lines.join('')).not.toContain('not-a-uuid');
    expect(lines.join('')).not.toContain('injected');
  });

  it('binds a context field the handler assigns once on every line of the message', async () => {
    await deliver(kafka({}), (logger) => {
      logger.assign({ tenantId: 'acme' });
      logger.info({ event: 'example.run' }, 'handled');
    });

    expect(lineWith('handled').tenantId).toBe('acme');
    expect(lineWith('message completed').tenantId).toBe('acme');
  });

  it('logs durationMs once per handled message', async () => {
    await deliver(kafka({}), (logger) => logger.info({ event: 'example.run' }, 'handled'));

    expect(lineWith('message completed').durationMs).toBeTypeOf('number');
    expect(lineWith('message completed').responseTime).toBeUndefined();
  });

  it('keeps two overlapping messages in their own context', async () => {
    let release = (): void => {};
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = deliver(kafka({ 'x-correlation-id': UUID_ONE }), async (logger) => {
      logger.assign({ tenantId: 'one' });
      await blocked;
      logger.info({ event: 'first' }, 'first');
    });
    const second = deliver(kafka({ 'x-correlation-id': UUID_TWO }), (logger) => {
      logger.assign({ tenantId: 'two' });
      logger.info({ event: 'second' }, 'second');
    });

    await second;
    release();
    await first;

    expect(lineWith('first').correlationId).toBe(UUID_ONE);
    expect(lineWith('first').tenantId).toBe('one');
    expect(lineWith('second').correlationId).toBe(UUID_TWO);
    expect(lineWith('second').tenantId).toBe('two');
  });

  it('redacts a credential on a message line', async () => {
    await deliver(kafka({}), (logger) =>
      logger.info({ event: 'example.run', authorization: 'Bearer secret' }, 'handled'),
    );

    expect(lineWith('handled').authorization).toBe('[Redacted]');
    expect(lines.join('')).not.toContain('Bearer secret');
  });

  it('logs an errored message with durationMs and the assigned fields', async () => {
    await deliver(kafka({}), (logger) => {
      logger.assign({ tenantId: 'acme' });
      throw new Error('boom');
    }).catch(() => {});

    expect(lineWith('message errored').durationMs).toBeTypeOf('number');
    expect(lineWith('message errored').tenantId).toBe('acme');
    expect((lineWith('message errored').err as { message: string }).message).toBe('boom');
  });
});

describe('context fields on message lines', () => {
  const hookFor = (contextFields?: readonly string[]): Hook => {
    const built = (createLoggerModule({ ...options, contextFields }).providers ?? []) as Array<{
      provide?: unknown;
      useValue?: Params;
      useFactory?: (params: Params) => Hook;
    }>;
    const paramsFor = built.find((provider) => provider.provide === PARAMS_PROVIDER_TOKEN)?.useValue;
    return built.find((provider) => provider.provide === PINO_PRE_REQUEST_HOOK)?.useFactory?.(
      paramsFor as Params,
    ) as Hook;
  };

  it('projects a message-data field onto the handler and closing lines', async () => {
    await deliverWith(hookFor(['scope']), kafka({}), (logger) => logger.info({ event: 'example.run' }, 'handled'), {
      scope: 'example',
    });

    expect(lineWith('handled').scope).toBe('example');
    expect(lineWith('message completed').scope).toBe('example');
  });

  it('leaves message lines without extra bindings when contextFields is absent', async () => {
    await deliverWith(
      hookFor(),
      kafka({}),
      (logger) => {
        logger.assign({ tenantId: 'acme' });
        logger.info({ event: 'example.run' }, 'handled');
      },
      { scope: 'example' },
    );

    expect(lineWith('handled').scope).toBeUndefined();
    expect(lineWith('message completed').scope).toBeUndefined();
    expect(lineWith('handled').tenantId).toBe('acme');
  });

  it('adds no context field when the message data is null, an array or a primitive', async () => {
    for (const data of [null, ['example'], 'example']) {
      lines.length = 0;
      await deliverWith(hookFor(['scope']), kafka({}), (logger) =>
        logger.info({ event: 'example.run' }, 'handled'), data);

      expect(lineWith('handled')).not.toHaveProperty('scope');
      expect(lineWith('message completed')).not.toHaveProperty('scope');
    }
  });

  it('ignores context fields that shadow automatic, base or module fields', async () => {
    const shadowing = {
      level: 'x', time: 'x', msg: 'x', service: 'x', durationMs: 'x', rpc: 'x',
      event: 'x', correlationId: 'x', outcome: 'x', req: 'x', responseTime: 'x',
    };
    await deliverWith(hookFor(Object.keys(shadowing)), kafka({}), (logger) =>
      logger.info({ event: 'example.run' }, 'handled'), shadowing);

    const handler = lineWith('handled');
    expect(handler.level).toBe(30);
    expect(handler.msg).toBe('handled');
    expect(handler.service).toBe('example-app');
    expect(handler.event).toBe('example.run');
    expect(handler.correlationId).toMatch(UUID_V4);
    expect(handler).not.toHaveProperty('req');
    expect(handler).not.toHaveProperty('responseTime');
    expect(lineWith('message completed').durationMs).toBeTypeOf('number');
  });

  it('keeps two overlapping messages in their own context data', async () => {
    let release = (): void => {};
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const hook = hookFor(['scope']);
    const first = deliverWith(hook, kafka({ 'x-correlation-id': UUID_ONE }), async (logger) => {
      await blocked;
      logger.info({ event: 'first' }, 'first');
    }, { scope: 'one' });
    const second = deliverWith(hook, kafka({ 'x-correlation-id': UUID_TWO }), (logger) =>
      logger.info({ event: 'second' }, 'second'), { scope: 'two' });

    await second;
    release();
    await first;

    expect(lineWith('first').scope).toBe('one');
    expect(lineWith('second').scope).toBe('two');
  });
});

describe('message correlation id', () => {
  it('accepts Buffer and array ids like correlationIdFrom', () => {
    expectTypeOf<MicroserviceLoggerOptions['genReqId']>().toEqualTypeOf<
      ((context: ExecutionContext) => string | Buffer | readonly string[]) | undefined
    >();
  });

  const hookWith = (microservice: LoggerOptions['microservice']): Hook => {
    const built = (createLoggerModule({ ...options, microservice }).providers ?? []) as Array<{
      provide?: unknown;
      useValue?: Params;
      useFactory?: (params: Params) => Hook;
    }>;
    const paramsFor = built.find((provider) => provider.provide === PARAMS_PROVIDER_TOKEN)?.useValue;
    return built.find((provider) => provider.provide === PINO_PRE_REQUEST_HOOK)?.useFactory?.(
      paramsFor as Params,
    ) as Hook;
  };

  const idLine = async (
    genReqId: (context: ExecutionContext) => unknown,
    context: unknown = kafka({}),
  ): Promise<Record<string, unknown>> => {
    await deliverWith(
      hookWith({ genReqId: genReqId as (context: ExecutionContext) => string }),
      context,
      (logger) => logger.info({ event: 'example.run' }, 'handled'),
    );
    return lineWith('handled');
  };

  it('binds an app-supplied canonical UUID to the handler and closing lines', async () => {
    let calls = 0;
    const hook = hookWith({ genReqId: () => (calls += 1, UUID_ONE) });
    await deliverWith(hook, new TcpContext([{} as never, 'example']), (logger) =>
      logger.info({ event: 'example.run' }, 'handled'),
    );

    expect(calls).toBe(1);
    expect(lineWith('handled').correlationId).toBe(UUID_ONE);
    expect(lineWith('message completed').correlationId).toBe(UUID_ONE);
  });

  it('prefers the app-supplied canonical id over an inbound header', async () => {
    const line = await idLine(() => UUID_TWO, kafka({ 'x-correlation-id': UUID_ONE }));

    expect(line.correlationId).toBe(UUID_TWO);
    expect(lineWith('message completed').correlationId).toBe(UUID_TWO);
  });

  it('generates an id for a non-canonical or raw header value', async () => {
    const raw = { 'x-correlation-id': Buffer.from(UUID_ONE) };
    for (const value of ['not-a-uuid', 'not-a-uuid\ninjected', raw]) {
      lines.length = 0;
      const line = await idLine(() => value);

      expect(line.correlationId).toMatch(UUID_V4);
      expect(lines.join('')).not.toContain('not-a-uuid');
      expect(lines.join('')).not.toContain('injected');
      expect(lines.join('')).not.toContain(UUID_ONE);
    }
  });

  it('accepts a canonical UUID in a Buffer and folds it to lowercase', async () => {
    const line = await idLine(() => Buffer.from(UUID_ONE.toUpperCase()));

    expect(line.correlationId).toBe(UUID_ONE);
  });

  it('generates an id for a Buffer that is not a canonical UUID', async () => {
    const line = await idLine(() => Buffer.from('not-a-uuid'));

    expect(line.correlationId).toMatch(UUID_V4);
    expect(lines.join('')).not.toContain('not-a-uuid');
  });

  it('generates an id for a non-string callback result', async () => {
    for (const value of [{ id: UUID_TWO }, 42]) {
      lines.length = 0;
      expect((await idLine(() => value)).correlationId).toMatch(UUID_V4);
    }
  });

  it('falls back to the transport metadata when the callback throws', async () => {
    const line = await idLine(() => {
      throw new Error('raw-throw-value');
    }, kafka({ 'x-correlation-id': UUID_ONE }));

    expect(line.correlationId).toBe(UUID_ONE);
    expect(lineWith('message completed').correlationId).toBe(UUID_ONE);
    expect(lines.join('')).not.toContain('raw-throw-value');
  });

  it('keeps the default resolver for microservice: true', async () => {
    await deliver(kafka({ 'x-correlation-id': UUID_ONE }), (logger) =>
      logger.info({ event: 'example.run' }, 'handled'),
    );

    expect(lineWith('handled').correlationId).toBe(UUID_ONE);
    expect(lineWith('message completed').correlationId).toBe(UUID_ONE);
  });
});

describe('automatic line events', () => {
  const deliverEvent = (
    autoEvents: LoggerOptions['autoEvents'],
    context: unknown,
    handle: (logger: PinoLogger) => void | Promise<void>,
  ): Promise<void> => {
    const built = (createLoggerModule({ ...options, autoEvents }).providers ?? []) as Array<{
      provide?: unknown;
      useValue?: Params;
      useFactory?: (params: Params) => Hook;
    }>;
    const paramsFor = built.find((provider) => provider.provide === PARAMS_PROVIDER_TOKEN)?.useValue;
    const hookFor = built.find((provider) => provider.provide === PINO_PRE_REQUEST_HOOK)?.useFactory?.(
      paramsFor as Params,
    ) as Hook;
    return deliverWith(hookFor, context, handle);
  };

  it('lets a handler-assigned event win on the automatic message completed line', async () => {
    await deliverEvent({ message: 'message.received' }, kafka({}), (logger) => {
      logger.assign({ event: 'handler-event' });
      logger.info({ event: 'handler' }, 'handled');
    });

    expect(lineWith('message completed').event).toBe('handler-event');
  });

  it('names the event on the automatic message errored line', async () => {
    await deliverEvent({ message: 'message.received' }, kafka({}), () => {
      throw new Error('boom');
    }).catch(() => {});

    expect(lineWith('message errored').event).toBe('message.received');
  });

  it('leaves automatic message lines without an event by default', async () => {
    await deliver(kafka({}), (logger) => logger.info({ event: 'handler' }, 'handled'));

    expect(lineWith('message completed').event).toBeUndefined();
  });

  it('keeps the handler event and msg while the automatic line carries the configured event', async () => {
    await deliverEvent({ message: 'message.received' }, kafka({ 'x-correlation-id': UUID_ONE }), (logger) =>
      logger.info({ event: 'handler' }, 'handled'),
    );

    expect(lineWith('handled').event).toBe('handler');
    expect(lineWith('handled').msg).toBe('handled');
    expect(lineWith('message completed').event).toBe('message.received');
    expect(lineWith('message completed').correlationId).toBe(UUID_ONE);
  });
});
