import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Hono } from 'hono';

import { RouteParamTypes } from '../enums.ts';
import { errorHandler } from '../utils/error-handler.util.ts';
import type { StandardSchema } from '../standard-schema.ts';
import type { TypedRouteArgResolver } from '../types.ts';
import { body, ctx, custom, headers, ip, next, param, query, req, res, scoped, validatedBody, validatedHeaders, validatedParam, validatedQuery } from './route-params.decorator.ts';

function fakeSchema<T>(validate: (value: unknown) => { value: T } | { issues: { message: string }[] }): StandardSchema<unknown, T> {
  return { '~standard': { version: 1, vendor: 'test', validate } };
}

test('route arg resolvers create the expected metadata shape', () => {
  assert.deepEqual(req(), { paramType: RouteParamTypes.REQUEST, data: undefined });
  assert.deepEqual(ctx(), { paramType: RouteParamTypes.CONTEXT, data: undefined });
  assert.deepEqual(res(), { paramType: RouteParamTypes.RESPONSE, data: undefined });
  assert.deepEqual(next(), { paramType: RouteParamTypes.NEXT, data: undefined });
  assert.deepEqual(query('search'), { paramType: RouteParamTypes.QUERY, data: 'search' });
  assert.deepEqual(param('id'), { paramType: RouteParamTypes.PARAM, data: 'id' });
  assert.deepEqual(body('name'), { paramType: RouteParamTypes.BODY, data: 'name' });
  assert.deepEqual(headers('x-token'), { paramType: RouteParamTypes.HEADERS, data: 'x-token' });
  assert.deepEqual(ip(), { paramType: RouteParamTypes.IP, data: undefined });
});

test('lookup-key resolvers reject non-string, non-nil data instead of silently discarding it', () => {
  assert.throws(() => query({ invalid: true } as unknown as string), TypeError);
  assert.throws(() => body(123 as unknown as string), TypeError);
  assert.throws(() => param(123 as unknown as string), TypeError);
  assert.throws(() => headers({ invalid: true } as unknown as string), TypeError);
});

test('custom() creates a custom resolver', () => {
  const handler = () => 'ok';
  const resolver = custom(handler, 'payload');

  assert.ok(resolver.handler);
  assert.deepEqual(resolver.paramType, RouteParamTypes.CUSTOM);
  assert.deepEqual(resolver.data, 'payload');
  assert.deepEqual(resolver.handler, handler);
});

test('custom() preserves non-string data payloads instead of discarding them', () => {
  const numericResolver = custom(() => 'ok', 42);
  const objectResolver = custom(() => 'ok', { foo: 'bar' });

  assert.deepEqual(numericResolver.data, 42);
  assert.deepEqual(objectResolver.data, { foo: 'bar' });
});

test('custom() binds resolver typing to the handler return type', () => {
  const syncResolver: TypedRouteArgResolver<string> = custom(() => 'ok');
  const asyncResolver: TypedRouteArgResolver<number> = custom(() => Promise.resolve(42));

  assert.deepEqual(syncResolver.paramType, RouteParamTypes.CUSTOM);
  assert.deepEqual(asyncResolver.paramType, RouteParamTypes.CUSTOM);

  // @ts-expect-error custom() infers the resolver type from the handler return value.
  const invalidResolver: TypedRouteArgResolver<number> = custom(() => 'ok');

  void invalidResolver;
});

test('ip() accepts an optional trustProxy option as its resolver data', () => {
  assert.deepEqual(ip(), { paramType: RouteParamTypes.IP, data: undefined });
  assert.deepEqual(ip({ trustProxy: true }), { paramType: RouteParamTypes.IP, data: { trustProxy: true } });
});

const nameSchema = fakeSchema<{ name: string }>((value) => {
  if (typeof value === 'object' && value !== null && typeof (value as { name?: unknown }).name === 'string') {
    return { value: value as { name: string } };
  }

  return { issues: [{ message: 'name is required and must be a string' }] };
});

test('validatedBody() resolves the validated body, and reports failures via errorHandler()', async () => {
  const app = new Hono();

  app.post('/', async (c) => {
    const resolver = validatedBody(nameSchema);

    return c.json(await resolver.handler!(c, resolver.data));
  });
  app.onError(errorHandler());

  const okResponse = await app.request('/', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'ok' }) });
  assert.deepEqual(okResponse.status, 200);
  assert.deepEqual(await okResponse.json(), { name: 'ok' });

  const badResponse = await app.request('/', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}) });
  assert.deepEqual(badResponse.status, 400);
  assert.deepEqual(await badResponse.json(), { error: 'Validation failed', issues: [{ message: 'name is required and must be a string' }] });
});

test('validatedBody() reports malformed JSON as a 400 ValidationError, not a raw 500', async () => {
  const app = new Hono();

  app.post('/', async (c) => {
    const resolver = validatedBody(nameSchema);

    return c.json(await resolver.handler!(c, resolver.data));
  });
  app.onError(errorHandler());

  const response = await app.request('/', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{not json' });

  assert.deepEqual(response.status, 400);
  const body = await response.json();
  assert.deepEqual(body.error, 'Validation failed');
  assert.deepEqual(body.issues.length, 1);
  assert.deepEqual(body.issues[0].message.includes('Invalid JSON body'), true);
});

test('validatedBody() does not echo the malformed body in its 400 response', async () => {
  const app = new Hono();

  app.post('/', async (c) => {
    const resolver = validatedBody(nameSchema);

    return c.json(await resolver.handler!(c, resolver.data));
  });
  app.onError(errorHandler());

  // Short (fully quoted by V8) and long (truncated excerpt, `..."…"...`) bodies.
  const pad = 'a'.repeat(100);

  for (const body of ['hunter2', '{"value": s3cr3t-abc}', `{"pad": "${pad}", "value": s3cr3t-abc, "more": "${pad}"}`]) {
    const response = await app.request('/', { method: 'POST', headers: { 'content-type': 'application/json' }, body });

    assert.deepEqual(response.status, 400);
    // Exact match: not even the first character of the value (`Unexpected token 's'`) may leak.
    assert.deepEqual(await response.json(), { error: 'Validation failed', issues: [{ message: 'Invalid JSON body' }] });
  }
});

test('validatedQuery() validates the parsed query string', async () => {
  const app = new Hono();

  app.get('/', async (c) => {
    const resolver = validatedQuery(nameSchema);

    return c.json(await resolver.handler!(c, resolver.data));
  });
  app.onError(errorHandler());

  const okResponse = await app.request('/?name=ok');
  assert.deepEqual(okResponse.status, 200);
  assert.deepEqual(await okResponse.json(), { name: 'ok' });

  const badResponse = await app.request('/');
  assert.deepEqual(badResponse.status, 400);
});

const idsSchema = fakeSchema<{ ids: string[] }>((value) => {
  const ids = (value as { ids?: unknown }).ids;

  if (Array.isArray(ids) && ids.every((id) => typeof id === 'string')) {
    return { value: { ids } };
  }

  return { issues: [{ message: 'ids must be an array of strings' }] };
});

test('validatedQuery() preserves repeated query keys as an array instead of dropping all but the last', async () => {
  const app = new Hono();

  app.get('/', async (c) => {
    const resolver = validatedQuery(idsSchema);

    return c.json(await resolver.handler!(c, resolver.data));
  });
  app.onError(errorHandler());

  const response = await app.request('/?ids=1&ids=2&ids=3');

  assert.deepEqual(response.status, 200);
  assert.deepEqual(await response.json(), { ids: ['1', '2', '3'] });
});

test('validatedParam() validates the route params', async () => {
  const app = new Hono();

  app.get('/:name', async (c) => {
    const resolver = validatedParam(nameSchema);

    return c.json(await resolver.handler!(c, resolver.data));
  });
  app.onError(errorHandler());

  const okResponse = await app.request('/ok');
  assert.deepEqual(okResponse.status, 200);
  assert.deepEqual(await okResponse.json(), { name: 'ok' });
});

test('validatedHeaders() validates the request headers', async () => {
  const app = new Hono();

  app.get('/', async (c) => {
    const resolver = validatedHeaders(nameSchema);

    return c.json(await resolver.handler!(c, resolver.data));
  });
  app.onError(errorHandler());

  const okResponse = await app.request('/', { headers: { name: 'ok' } });
  assert.deepEqual(okResponse.status, 200);
  assert.deepEqual(await okResponse.json(), { name: 'ok' });

  const badResponse = await app.request('/');
  assert.deepEqual(badResponse.status, 400);
});

test('scoped() throws a clear error when the controller was not mounted via assignModule()', async () => {
  class Anything {}

  const app = new Hono();

  app.get('/', async (c) => {
    const resolver = scoped(Anything);

    return c.json(await resolver.handler!(c, resolver.data) as unknown as Record<string, unknown>);
  });
  app.onError(errorHandler());

  const response = await app.request('/');

  assert.deepEqual(response.status, 500);
});
