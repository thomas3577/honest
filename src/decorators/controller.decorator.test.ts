import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Hono } from 'hono';
import type { Context } from 'hono';

import { Get, HttpCode, Post } from './http-methods.decorator.ts';
import { body, ctx, custom, headers, ip, next, param, query, req, res } from './route-params.decorator.ts';
import { Controller, sendResult } from './controller.decorator.ts';
import { registerMiddlewareMethodDecorator } from '../utils/router.util.ts';
import { mountController } from '../utils/mount-controller.test.ts';
import type { ControllerClass, ParamData } from '../types.ts';

function RuntimeMiddleware<This extends object, Args extends unknown[], Return>(
  _value: (this: This, ...args: Args) => Return,
  context: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => Return>,
) {
  registerMiddlewareMethodDecorator(context, async (c, next) => {
    middlewareEvents.push('middleware:before');
    c.header('x-middleware', 'ran');
    await next();
    middlewareEvents.push('middleware:after');
  });
}

const inheritedMiddlewareEvents: string[] = [];

function BaseRuntimeMiddleware<This extends object, Args extends unknown[], Return>(
  _value: (this: This, ...args: Args) => Return,
  context: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => Return>,
) {
  registerMiddlewareMethodDecorator(context, async (c, next) => {
    inheritedMiddlewareEvents.push('base:before');
    c.header('x-base-middleware', 'ran');
    await next();
    inheritedMiddlewareEvents.push('base:after');
  });
}

function ChildRuntimeMiddleware<This extends object, Args extends unknown[], Return>(
  _value: (this: This, ...args: Args) => Return,
  context: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => Return>,
) {
  registerMiddlewareMethodDecorator(context, async (c, next) => {
    inheritedMiddlewareEvents.push('child:before');
    c.header('x-child-middleware', 'ran');
    await next();
    inheritedMiddlewareEvents.push('child:after');
  });
}

function SiblingRuntimeMiddleware<This extends object, Args extends unknown[], Return>(
  _value: (this: This, ...args: Args) => Return,
  context: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => Return>,
) {
  registerMiddlewareMethodDecorator(context, async (c, next) => {
    inheritedMiddlewareEvents.push('sibling:before');
    c.header('x-sibling-middleware', 'ran');
    await next();
    inheritedMiddlewareEvents.push('sibling:after');
  });
}

@Controller('users')
class ParameterController {
  @Post(':id', [ctx<Context>(), req<Context['req']>(), res<Context>(), next<() => Promise<unknown>>(), query<URLSearchParams>(), param<Record<string, string>>(), body<Record<string, string>>(), headers<Record<string, string>>(), ip()])
  create(
    requestContext: Context,
    request: Context['req'],
    response: Context,
    nextFn: () => Promise<unknown>,
    searchParams: URLSearchParams,
    params: Record<string, string>,
    requestBody: Record<string, string>,
    requestHeaders: Record<string, string>,
    ipAddress: string,
  ) {
    return {
      path: requestContext.req.path,
      reqMatches: request === requestContext.req,
      resIsContext: response === requestContext,
      nextType: typeof nextFn,
      query: searchParams.get('q'),
      param: params.id,
      body: requestBody.name,
      header: requestHeaders['x-test'],
      ip: ipAddress,
    };
  }
}

const middlewareEvents: string[] = [];

@Controller('tasks')
class RuntimeController {
  @RuntimeMiddleware
  @Get(':id', [query<string | undefined>('filter'), param<string>('id'), custom((routeContext: Context, data?: ParamData) => `${routeContext.req.param('id')}:${String(data)}`, 'extra')])
  index(
    filter: string | undefined,
    id: string,
    customValue: string,
  ) {
    middlewareEvents.push(`handler:${filter}:${id}:${customValue}`);

    return {
      filter,
      id,
      customValue,
    };
  }
}

@Controller('inherit-base')
class BaseInheritedMiddlewareController {
  @BaseRuntimeMiddleware
  @Get('shared')
  shared() {
    inheritedMiddlewareEvents.push('handler:base');

    return {
      controller: 'base',
    };
  }
}

@Controller('inherit-child')
class ChildInheritedMiddlewareController extends BaseInheritedMiddlewareController {
  @ChildRuntimeMiddleware
  @Get('shared')
  override shared() {
    inheritedMiddlewareEvents.push('handler:child');

    return {
      controller: 'child',
    };
  }
}

@Controller('inherit-sibling')
class SiblingInheritedMiddlewareController extends BaseInheritedMiddlewareController {
  @SiblingRuntimeMiddleware
  @Get('shared')
  override shared() {
    inheritedMiddlewareEvents.push('handler:sibling');

    return {
      controller: 'sibling',
    };
  }
}

@Controller('empty')
class UndefinedResultController {
  @Get('noop')
  noop() {
    return undefined;
  }
}

@Controller('mapped')
class MappedArgsController {
  @Post(':id', [param<string>('id'), body<{ name: string }>(), query<string | undefined>('dryRun')])
  update(
    id: string,
    requestBody: { name: string },
    dryRun: string | undefined,
    c: Context,
  ) {
    return {
      id,
      bodyName: requestBody.name,
      dryRun,
      path: c.req.path,
    };
  }

  @Get()
  current(c: Context) {
    return {
      path: c.req.path,
    };
  }
}

test('Controller init() composes prefixes and injects standard route params', async () => {
  const app = mountController(new ParameterController() as unknown as ControllerClass, 'api');
  const response = await app.request('http://localhost/api/users/123?q=abc', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-test': '1',
    },
    body: JSON.stringify({ name: 'oakest' }),
  });

  assert.ok(response);
  assert.deepEqual(response.status, 200);
  assert.deepEqual(await response.json(), {
    path: '/api/users/123',
    reqMatches: true,
    resIsContext: true,
    nextType: 'function',
    query: 'abc',
    param: '123',
    body: 'oakest',
    header: '1',
    ip: '',
  });
});

test('Controller routes execute middleware before handlers and resolve custom params', async () => {
  middlewareEvents.length = 0;

  const app = mountController(new RuntimeController() as unknown as ControllerClass);
  const response = await app.request('http://localhost/tasks/42?filter=open');

  assert.ok(response);
  assert.deepEqual(response.status, 200);
  assert.deepEqual(response.headers.get('x-middleware'), 'ran');
  assert.deepEqual(await response.json(), {
    filter: 'open',
    id: '42',
    customValue: '42:extra',
  });
  assert.deepEqual(middlewareEvents, [
    'middleware:before',
    'handler:open:42:42:extra',
    'middleware:after',
  ]);
});

test('Controller decoration clones inherited middleware metadata before appending', async () => {
  inheritedMiddlewareEvents.length = 0;

  const baseApp = mountController(new BaseInheritedMiddlewareController() as unknown as ControllerClass);
  const baseResponse = await baseApp.request('http://localhost/inherit-base/shared');

  assert.ok(baseResponse);
  assert.deepEqual(baseResponse.status, 200);
  assert.deepEqual(baseResponse.headers.get('x-base-middleware'), 'ran');
  assert.deepEqual(baseResponse.headers.get('x-child-middleware'), null);
  assert.deepEqual(await baseResponse.json(), {
    controller: 'base',
  });
  assert.deepEqual(inheritedMiddlewareEvents, [
    'base:before',
    'handler:base',
    'base:after',
  ]);

  inheritedMiddlewareEvents.length = 0;

  const childApp = mountController(new ChildInheritedMiddlewareController() as unknown as ControllerClass);
  const childResponse = await childApp.request('http://localhost/inherit-child/shared');

  assert.ok(childResponse);
  assert.deepEqual(childResponse.status, 200);
  assert.deepEqual(childResponse.headers.get('x-base-middleware'), 'ran');
  assert.deepEqual(childResponse.headers.get('x-child-middleware'), 'ran');
  assert.deepEqual(await childResponse.json(), {
    controller: 'child',
  });
  assert.deepEqual(inheritedMiddlewareEvents, [
    'base:before',
    'child:before',
    'handler:child',
    'child:after',
    'base:after',
  ]);
});

test('Controller decoration does not leak middleware between sibling subclasses of the same base', async () => {
  inheritedMiddlewareEvents.length = 0;

  const siblingApp = mountController(new SiblingInheritedMiddlewareController() as unknown as ControllerClass);
  const siblingResponse = await siblingApp.request('http://localhost/inherit-sibling/shared');

  assert.ok(siblingResponse);
  assert.deepEqual(siblingResponse.status, 200);
  assert.deepEqual(siblingResponse.headers.get('x-base-middleware'), 'ran');
  assert.deepEqual(siblingResponse.headers.get('x-sibling-middleware'), 'ran');
  assert.deepEqual(siblingResponse.headers.get('x-child-middleware'), null);
  assert.deepEqual(await siblingResponse.json(), {
    controller: 'sibling',
  });
  assert.deepEqual(inheritedMiddlewareEvents, [
    'base:before',
    'sibling:before',
    'handler:sibling',
    'sibling:after',
    'base:after',
  ]);

  inheritedMiddlewareEvents.length = 0;

  const childApp = mountController(new ChildInheritedMiddlewareController() as unknown as ControllerClass);
  const childResponse = await childApp.request('http://localhost/inherit-child/shared');

  assert.ok(childResponse);
  assert.deepEqual(childResponse.status, 200);
  assert.deepEqual(childResponse.headers.get('x-child-middleware'), 'ran');
  assert.deepEqual(childResponse.headers.get('x-sibling-middleware'), null);
  assert.deepEqual(inheritedMiddlewareEvents, [
    'base:before',
    'child:before',
    'handler:child',
    'child:after',
    'base:after',
  ]);
});

test('Controller handlers that return undefined leave the response untouched', async () => {
  const app = mountController(new UndefinedResultController() as unknown as ControllerClass);
  const response = await app.request('http://localhost/empty/noop');

  assert.ok(response);
  assert.deepEqual(response.status, 404);
});

test('Controller handlers resolve mapped args and append ctx as the final implicit parameter', async () => {
  const app = mountController(new MappedArgsController() as unknown as ControllerClass);
  const response = await app.request('http://localhost/mapped/123?dryRun=yes', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({ name: 'oakest' }),
  });

  assert.ok(response);
  assert.deepEqual(response.status, 200);
  assert.deepEqual(await response.json(), {
    id: '123',
    bodyName: 'oakest',
    dryRun: 'yes',
    path: '/mapped/123',
  });
});

@Controller('missing')
class MissingArgsController {
  @Post(':id', [query<string | undefined>('absent'), param<string | undefined>('absent'), headers<string | undefined>('x-absent'), body<string | undefined>('name')])
  check(queryValue: string | undefined, paramValue: string | undefined, headerValue: string | undefined, bodyValue: string | undefined) {
    return [queryValue, paramValue, headerValue, bodyValue].map((value) => value === undefined ? 'undefined' : String(value));
  }
}

test('Controller resolves absent query/param/header/body keys as undefined, not null, and tolerates a null JSON body', async () => {
  const app = mountController(new MissingArgsController() as unknown as ControllerClass);
  const response = await app.request('http://localhost/missing/1', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: 'null',
  });

  assert.deepEqual(response.status, 200);
  assert.deepEqual(await response.json(), ['undefined', 'undefined', 'undefined', 'undefined']);
});

test('Controller handlers without explicit route arg mapping receive ctx as the only parameter', async () => {
  const app = mountController(new MappedArgsController() as unknown as ControllerClass);
  const response = await app.request('http://localhost/mapped');

  assert.ok(response);
  assert.deepEqual(response.status, 200);
  assert.deepEqual(await response.json(), {
    path: '/mapped',
  });
});

@Controller('invalid')
class InvalidMappedController {
  @Get('broken')
  broken(first: string, second: string) {
    return { first, second };
  }
}

test('Controller handlers with multiple parameters require explicit route arg mapping', async () => {
  const app = mountController(new InvalidMappedController() as unknown as ControllerClass);
  const response = await app.request('http://localhost/invalid/broken');

  assert.ok(response);
  assert.deepEqual(response.status, 500);
});

test('sendResult() maps handler return values onto a Hono Response', async () => {
  const app = new Hono();

  app.get('/undefined', (c) => sendResult(c, undefined));
  app.get('/null', (c) => sendResult(c, null));
  app.get('/response', (c) => sendResult(c, new Response('custom', { status: 201 })));
  app.get('/string', (c) => sendResult(c, 'plain text'));
  app.get('/uint8array', (c) => sendResult(c, new TextEncoder().encode('bytes')));
  app.get('/arraybuffer', (c) => sendResult(c, new TextEncoder().encode('buffer').buffer));
  app.get('/object', (c) => sendResult(c, { ok: true }));

  const undefinedResponse = await app.request('/undefined');
  assert.deepEqual(undefinedResponse.status, 404);

  // null is a deliberate JSON value, distinct from "no result" (undefined) — see sendResult()'s docstring.
  const nullResponse = await app.request('/null');
  assert.deepEqual(nullResponse.status, 200);
  assert.deepEqual(nullResponse.headers.get('content-type')?.includes('application/json'), true);
  assert.deepEqual(await nullResponse.text(), 'null');

  const responseResponse = await app.request('/response');
  assert.deepEqual(responseResponse.status, 201);
  assert.deepEqual(await responseResponse.text(), 'custom');

  const stringResponse = await app.request('/string');
  assert.deepEqual(stringResponse.status, 200);
  // Hono's c.text() leaves text/plain to the runtime's Response, which Bun
  // only adds once the response goes over the wire — so assert "not JSON".
  assert.equal(stringResponse.headers.get('content-type')?.includes('application/json') ?? false, false);
  assert.deepEqual(await stringResponse.text(), 'plain text');

  const uint8Response = await app.request('/uint8array');
  assert.deepEqual(uint8Response.status, 200);
  assert.deepEqual(await uint8Response.text(), 'bytes');

  const arrayBufferResponse = await app.request('/arraybuffer');
  assert.deepEqual(arrayBufferResponse.status, 200);
  assert.deepEqual(await arrayBufferResponse.text(), 'buffer');

  const objectResponse = await app.request('/object');
  assert.deepEqual(objectResponse.status, 200);
  assert.deepEqual(await objectResponse.json(), { ok: true });
});

@Controller('geo')
class IpProxyController {
  @Get('trusted', [ip({ trustProxy: true })])
  trusted(ipAddress: string) {
    return { ip: ipAddress };
  }

  @Get('untrusted', [ip()])
  untrusted(ipAddress: string) {
    return { ip: ipAddress };
  }
}

test('ip({ trustProxy: true }) prefers X-Forwarded-For over the raw connection address', async () => {
  const app = mountController(new IpProxyController() as unknown as ControllerClass);

  const trustedResponse = await app.request('http://localhost/geo/trusted', {
    headers: { 'x-forwarded-for': '203.0.113.5, 10.0.0.1' },
  });
  assert.deepEqual(await trustedResponse.json(), { ip: '203.0.113.5' });

  // Without trustProxy, the header is ignored; app.request() has no real
  // socket, so this falls back to the documented '' default.
  const untrustedResponse = await app.request('http://localhost/geo/untrusted', {
    headers: { 'x-forwarded-for': '203.0.113.5, 10.0.0.1' },
  });
  assert.deepEqual(await untrustedResponse.json(), { ip: '' });
});

test('ip() reads the connection address from the env each runtime server passes to Hono', async () => {
  const app = mountController(new IpProxyController() as unknown as ControllerClass);
  const url = 'http://localhost/geo/untrusted';
  const bunServer = {
    address: '198.51.100.2',
    requestIP(this: { address: string }) {
      return { address: this.address };
    },
  };

  const denoResponse = await app.request(url, {}, { remoteAddr: { hostname: '198.51.100.1' } });
  assert.deepEqual(await denoResponse.json(), { ip: '198.51.100.1' });

  const bunResponse = await app.request(url, {}, bunServer);
  assert.deepEqual(await bunResponse.json(), { ip: '198.51.100.2' });

  const bunWrappedResponse = await app.request(url, {}, { server: bunServer });
  assert.deepEqual(await bunWrappedResponse.json(), { ip: '198.51.100.2' });

  const nodeResponse = await app.request(url, {}, { incoming: { socket: { remoteAddress: '198.51.100.3' } } });
  assert.deepEqual(await nodeResponse.json(), { ip: '198.51.100.3' });
});

@Controller('codes')
class HttpCodeController {
  @Post('created')
  @HttpCode(201)
  created() {
    return { id: 1 };
  }

  @HttpCode(204)
  @Get('no-content')
  noContent() {
    return { ignored: true };
  }

  @HttpCode(201)
  @Get('missing')
  missing() {
    return undefined;
  }

  @HttpCode(201)
  @Get('own-response')
  ownResponse() {
    return new Response('custom', { status: 202 });
  }
}

test('@HttpCode() sets the status of returned values, regardless of decorator order', async () => {
  const app = mountController(new HttpCodeController() as unknown as ControllerClass);

  const created = await app.request('/codes/created', { method: 'POST' });
  assert.deepEqual(created.status, 201);
  assert.deepEqual(await created.json(), { id: 1 });

  const noContent = await app.request('/codes/no-content');
  assert.deepEqual(noContent.status, 204);
  assert.deepEqual(await noContent.text(), '');

  const missing = await app.request('/codes/missing');
  assert.deepEqual(missing.status, 404);

  const ownResponse = await app.request('/codes/own-response');
  assert.deepEqual(ownResponse.status, 202);
  assert.deepEqual(await ownResponse.text(), 'custom');
});

test('@HttpCode() rejects a status outside 200-599', () => {
  assert.throws(() => HttpCode(100), { message: '@HttpCode() expects an integer status from 200 to 599, got 100.' });
  assert.throws(() => HttpCode(600), { message: '@HttpCode() expects an integer status from 200 to 599, got 600.' });
  assert.throws(() => HttpCode(201.5), { message: '@HttpCode() expects an integer status from 200 to 599, got 201.5.' });
});
