import { assertEquals, assertExists, assertThrows } from '@std/assert';
import { Hono } from 'hono';

import { RouteParamTypes } from '../enums.ts';
import { errorHandler } from '../utils/error-handler.util.ts';
import type { StandardSchema } from '../standard-schema.ts';
import type { TypedRouteArgResolver } from '../types.ts';
import { body, ctx, custom, headers, ip, next, param, query, req, res, scoped, validatedBody, validatedHeaders, validatedParam, validatedQuery } from './route-params.decorator.ts';

function fakeSchema<T>(validate: (value: unknown) => { value: T } | { issues: { message: string }[] }): StandardSchema<unknown, T> {
  return { '~standard': { version: 1, vendor: 'test', validate } };
}

Deno.test('route arg resolvers create the expected metadata shape', () => {
  assertEquals(req(), { paramType: RouteParamTypes.REQUEST, data: undefined });
  assertEquals(ctx(), { paramType: RouteParamTypes.CONTEXT, data: undefined });
  assertEquals(res(), { paramType: RouteParamTypes.RESPONSE, data: undefined });
  assertEquals(next(), { paramType: RouteParamTypes.NEXT, data: undefined });
  assertEquals(query('search'), { paramType: RouteParamTypes.QUERY, data: 'search' });
  assertEquals(param('id'), { paramType: RouteParamTypes.PARAM, data: 'id' });
  assertEquals(body('name'), { paramType: RouteParamTypes.BODY, data: 'name' });
  assertEquals(headers('x-token'), { paramType: RouteParamTypes.HEADERS, data: 'x-token' });
  assertEquals(ip(), { paramType: RouteParamTypes.IP, data: undefined });
});

Deno.test('lookup-key resolvers reject non-string, non-nil data instead of silently discarding it', () => {
  assertThrows(() => query({ invalid: true } as unknown as string), TypeError);
  assertThrows(() => body(123 as unknown as string), TypeError);
  assertThrows(() => param(123 as unknown as string), TypeError);
  assertThrows(() => headers({ invalid: true } as unknown as string), TypeError);
});

Deno.test('custom() creates a custom resolver', () => {
  const handler = () => 'ok';
  const resolver = custom(handler, 'payload');

  assertExists(resolver.handler);
  assertEquals(resolver.paramType, RouteParamTypes.CUSTOM);
  assertEquals(resolver.data, 'payload');
  assertEquals(resolver.handler, handler);
});

Deno.test('custom() preserves non-string data payloads instead of discarding them', () => {
  const numericResolver = custom(() => 'ok', 42);
  const objectResolver = custom(() => 'ok', { foo: 'bar' });

  assertEquals(numericResolver.data, 42);
  assertEquals(objectResolver.data, { foo: 'bar' });
});

Deno.test('custom() binds resolver typing to the handler return type', () => {
  const syncResolver: TypedRouteArgResolver<string> = custom(() => 'ok');
  const asyncResolver: TypedRouteArgResolver<number> = custom(() => Promise.resolve(42));

  assertEquals(syncResolver.paramType, RouteParamTypes.CUSTOM);
  assertEquals(asyncResolver.paramType, RouteParamTypes.CUSTOM);

  // @ts-expect-error custom() infers the resolver type from the handler return value.
  const invalidResolver: TypedRouteArgResolver<number> = custom(() => 'ok');

  void invalidResolver;
});

Deno.test('ip() accepts an optional trustProxy option as its resolver data', () => {
  assertEquals(ip(), { paramType: RouteParamTypes.IP, data: undefined });
  assertEquals(ip({ trustProxy: true }), { paramType: RouteParamTypes.IP, data: { trustProxy: true } });
});

const nameSchema = fakeSchema<{ name: string }>((value) => {
  if (typeof value === 'object' && value !== null && typeof (value as { name?: unknown }).name === 'string') {
    return { value: value as { name: string } };
  }

  return { issues: [{ message: 'name is required and must be a string' }] };
});

Deno.test('validatedBody() resolves the validated body, and reports failures via errorHandler()', async () => {
  const app = new Hono();

  app.post('/', async (c) => {
    const resolver = validatedBody(nameSchema);

    return c.json(await resolver.handler!(c, resolver.data));
  });
  app.onError(errorHandler());

  const okResponse = await app.request('/', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'ok' }) });
  assertEquals(okResponse.status, 200);
  assertEquals(await okResponse.json(), { name: 'ok' });

  const badResponse = await app.request('/', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}) });
  assertEquals(badResponse.status, 400);
  assertEquals(await badResponse.json(), { error: 'Validation failed', issues: [{ message: 'name is required and must be a string' }] });
});

Deno.test('validatedBody() reports malformed JSON as a 400 ValidationError, not a raw 500', async () => {
  const app = new Hono();

  app.post('/', async (c) => {
    const resolver = validatedBody(nameSchema);

    return c.json(await resolver.handler!(c, resolver.data));
  });
  app.onError(errorHandler());

  const response = await app.request('/', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{not json' });

  assertEquals(response.status, 400);
  const body = await response.json();
  assertEquals(body.error, 'Validation failed');
  assertEquals(body.issues.length, 1);
  assertEquals(body.issues[0].message.includes('Invalid JSON body'), true);
});

Deno.test('validatedQuery() validates the parsed query string', async () => {
  const app = new Hono();

  app.get('/', async (c) => {
    const resolver = validatedQuery(nameSchema);

    return c.json(await resolver.handler!(c, resolver.data));
  });
  app.onError(errorHandler());

  const okResponse = await app.request('/?name=ok');
  assertEquals(okResponse.status, 200);
  assertEquals(await okResponse.json(), { name: 'ok' });

  const badResponse = await app.request('/');
  assertEquals(badResponse.status, 400);
});

const idsSchema = fakeSchema<{ ids: string[] }>((value) => {
  const ids = (value as { ids?: unknown }).ids;

  if (Array.isArray(ids) && ids.every((id) => typeof id === 'string')) {
    return { value: { ids } };
  }

  return { issues: [{ message: 'ids must be an array of strings' }] };
});

Deno.test('validatedQuery() preserves repeated query keys as an array instead of dropping all but the last', async () => {
  const app = new Hono();

  app.get('/', async (c) => {
    const resolver = validatedQuery(idsSchema);

    return c.json(await resolver.handler!(c, resolver.data));
  });
  app.onError(errorHandler());

  const response = await app.request('/?ids=1&ids=2&ids=3');

  assertEquals(response.status, 200);
  assertEquals(await response.json(), { ids: ['1', '2', '3'] });
});

Deno.test('validatedParam() validates the route params', async () => {
  const app = new Hono();

  app.get('/:name', async (c) => {
    const resolver = validatedParam(nameSchema);

    return c.json(await resolver.handler!(c, resolver.data));
  });
  app.onError(errorHandler());

  const okResponse = await app.request('/ok');
  assertEquals(okResponse.status, 200);
  assertEquals(await okResponse.json(), { name: 'ok' });
});

Deno.test('validatedHeaders() validates the request headers', async () => {
  const app = new Hono();

  app.get('/', async (c) => {
    const resolver = validatedHeaders(nameSchema);

    return c.json(await resolver.handler!(c, resolver.data));
  });
  app.onError(errorHandler());

  const okResponse = await app.request('/', { headers: { name: 'ok' } });
  assertEquals(okResponse.status, 200);
  assertEquals(await okResponse.json(), { name: 'ok' });

  const badResponse = await app.request('/');
  assertEquals(badResponse.status, 400);
});

Deno.test('scoped() throws a clear error when the controller was not mounted via assignModule()', async () => {
  class Anything {}

  const app = new Hono();

  app.get('/', async (c) => {
    const resolver = scoped(Anything);

    return c.json(await resolver.handler!(c, resolver.data) as unknown as Record<string, unknown>);
  });
  app.onError(errorHandler());

  const response = await app.request('/');

  assertEquals(response.status, 500);
});
