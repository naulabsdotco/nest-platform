import type { ExecutionContext } from '@nestjs/common';
import { KafkaContext, NatsContext, RmqContext, TcpContext } from '@nestjs/microservices';
import { PARAMS_PROVIDER_TOKEN, PINO_PRE_REQUEST_HOOK, PinoLogger, type Params } from 'nestjs-pino';
import { beforeEach, describe, expect, it } from 'vitest';
import { createLoggerModule, type LoggerOptions } from './logger.module';

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

const contextOf = (context: unknown): ExecutionContext =>
  ({ getType: () => 'rpc', switchToRpc: () => ({ getContext: () => context, getData: () => ({}) }) }) as unknown as
    ExecutionContext;

const deliver = (context: unknown, handle: (logger: PinoLogger) => void | Promise<void>): Promise<void> => {
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
    hook(contextOf(context), () => source).subscribe({ next: () => {}, error: reject, complete: resolve });
  });
};

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
