import assert from 'node:assert/strict';
import process from 'node:process';
import { test } from 'node:test';

import { ValidationError } from '../errors.ts';
import type { StandardSchema } from '../standard-schema.ts';
import { createInjector } from '../utils/injector.util.ts';
import { Config } from './config.decorator.ts';
import { inject, Injectable } from './injectable.ts';

type FakeSchemaResult<T> = { value: T } | { issues: { message: string }[] };

function fakeSchema<T>(validate: (value: unknown) => FakeSchemaResult<T> | Promise<FakeSchemaResult<T>>): StandardSchema<unknown, T> {
  return { '~standard': { version: 1, vendor: 'test', validate } };
}

const portSchema = fakeSchema<{ port: number }>((value) => {
  const port = (value as Record<string, unknown>).PORT;

  return typeof port === 'string' && port.length > 0 && !Number.isNaN(Number(port)) ? { value: { port: Number(port) } } : { issues: [{ message: 'PORT must be numeric' }] };
});

test('Config() validates the source synchronously and exposes the result as .value, typed with no cast', () => {
  class AppConfig extends Config(portSchema, () => ({ PORT: '4000' })) {}

  const config = new AppConfig();

  assert.deepEqual(config.value, { port: 4000 });
});

test('Config() throws ValidationError when the source fails validation', () => {
  class AppConfig extends Config(portSchema, () => ({ PORT: 'nope' })) {}

  assert.throws(() => new AppConfig(), (error) => {
    assert.ok(error instanceof ValidationError);
    assert.deepEqual(error.issues, [{ message: 'PORT must be numeric' }]);

    return true;
  });
});

test('Config() throws a clear error for a schema that validates asynchronously', () => {
  const asyncSchema = fakeSchema<{ port: number }>(() => Promise.resolve({ value: { port: 1 } }));

  class AppConfig extends Config(asyncSchema, () => ({})) {}

  assert.throws(() => new AppConfig(), { message: /synchronously/ });
});

test('Config() does not leave an unhandled rejection behind when an async schema later rejects', async () => {
  const asyncRejectingSchema = fakeSchema<{ port: number }>(() => Promise.reject(new Error('async validator failed')));

  class AppConfig extends Config(asyncRejectingSchema, () => ({})) {}

  assert.throws(() => new AppConfig(), { message: /synchronously/ });

  // Give the rejected promise a turn to surface as an unhandled rejection
  // if Config() hadn't attached a handler to it — that would otherwise
  // crash the process instead of staying contained to the thrown error above.
  await new Promise((resolve) => setTimeout(resolve, 0));
});

test('Config() defaults its source to process.env', () => {
  process.env.HONEST_TEST_PORT = '9090';

  try {
    const schema = fakeSchema<{ port: number }>((value) => {
      const port = (value as Record<string, unknown>).HONEST_TEST_PORT;

      return typeof port === 'string' ? { value: { port: Number(port) } } : { issues: [{ message: 'missing' }] };
    });

    class AppConfig extends Config(schema) {}

    assert.deepEqual(new AppConfig().value, { port: 9090 });
  } finally {
    delete process.env.HONEST_TEST_PORT;
  }
});

test('Config() works via inject() like the documented usage', () => {
  class AppConfig extends Config(portSchema, () => ({ PORT: '8080' })) {}

  @Injectable()
  class GreeterService {
    constructor(private readonly config = inject(AppConfig)) {}

    describePort(): string {
      return `port:${this.config.value.port}`;
    }
  }

  const injector = createInjector([AppConfig, GreeterService]);
  const service = injector.resolve(GreeterService);

  assert.deepEqual(service.describePort(), 'port:8080');
});
