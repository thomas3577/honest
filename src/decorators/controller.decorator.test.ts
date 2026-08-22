import { assertEquals, assertExists } from '@std/assert';
import { Hono } from 'hono';
import type { Context } from 'hono';

import { Get, Post } from './http-methods.decorator.ts';
import { body, ctx, custom, headers, ip, next, param, query, req, res } from './route-params.decorator.ts';
import { Controller, sendResult } from './controller.decorator.ts';
import { registerMiddlewareMethodDecorator } from '../utils/router.util.ts';
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

const mountController = (controller: { path?: string; route?: Hono; init(routePrefix?: string): void }, routePrefix?: string) => {
  controller.init(routePrefix);

  assertExists(controller.path);
  assertExists(controller.route);

  const app = new Hono();

  app.route(controller.path || '/', controller.route);

  return app;
};

@Controller('users')
class ParameterController {
  @Post(':id', [ctx<Context>(), req<Context['req']>(), res<Context>(), next<() => Promise<unknown>>(), query<URLSearchParams>(), param<Record<string, string>>(), body<Record<string, string>>(), headers<Record<string, string>>(), ip<string>()])
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
  @Get(':id', [query<string | null>('filter'), param<string>('id'), custom((routeContext: Context, data?: ParamData) => `${routeContext.req.param('id')}:${String(data)}`, 'extra')])
  index(
    filter: string | null,
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
  @Post(':id', [param<string>('id'), body<{ name: string }>(), query<string | null>('dryRun')])
  update(
    id: string,
    requestBody: { name: string },
    dryRun: string | null,
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

Deno.test('Controller init() composes prefixes and injects standard route params', async () => {
  const app = mountController(new ParameterController() as unknown as ControllerClass, 'api');
  const response = await app.request('http://localhost/api/users/123?q=abc', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-test': '1',
    },
    body: JSON.stringify({ name: 'oakest' }),
  });

  assertExists(response);
  assertEquals(response.status, 200);
  assertEquals(await response.json(), {
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

Deno.test('Controller routes execute middleware before handlers and resolve custom params', async () => {
  middlewareEvents.length = 0;

  const app = mountController(new RuntimeController() as unknown as ControllerClass);
  const response = await app.request('http://localhost/tasks/42?filter=open');

  assertExists(response);
  assertEquals(response.status, 200);
  assertEquals(response.headers.get('x-middleware'), 'ran');
  assertEquals(await response.json(), {
    filter: 'open',
    id: '42',
    customValue: '42:extra',
  });
  assertEquals(middlewareEvents, [
    'middleware:before',
    'handler:open:42:42:extra',
    'middleware:after',
  ]);
});

Deno.test('Controller decoration clones inherited middleware metadata before appending', async () => {
  inheritedMiddlewareEvents.length = 0;

  const baseApp = mountController(new BaseInheritedMiddlewareController() as unknown as ControllerClass);
  const baseResponse = await baseApp.request('http://localhost/inherit-base/shared');

  assertExists(baseResponse);
  assertEquals(baseResponse.status, 200);
  assertEquals(baseResponse.headers.get('x-base-middleware'), 'ran');
  assertEquals(baseResponse.headers.get('x-child-middleware'), null);
  assertEquals(await baseResponse.json(), {
    controller: 'base',
  });
  assertEquals(inheritedMiddlewareEvents, [
    'base:before',
    'handler:base',
    'base:after',
  ]);

  inheritedMiddlewareEvents.length = 0;

  const childApp = mountController(new ChildInheritedMiddlewareController() as unknown as ControllerClass);
  const childResponse = await childApp.request('http://localhost/inherit-child/shared');

  assertExists(childResponse);
  assertEquals(childResponse.status, 200);
  assertEquals(childResponse.headers.get('x-base-middleware'), 'ran');
  assertEquals(childResponse.headers.get('x-child-middleware'), 'ran');
  assertEquals(await childResponse.json(), {
    controller: 'child',
  });
  assertEquals(inheritedMiddlewareEvents, [
    'base:before',
    'child:before',
    'handler:child',
    'child:after',
    'base:after',
  ]);
});

Deno.test('Controller decoration does not leak middleware between sibling subclasses of the same base', async () => {
  inheritedMiddlewareEvents.length = 0;

  const siblingApp = mountController(new SiblingInheritedMiddlewareController() as unknown as ControllerClass);
  const siblingResponse = await siblingApp.request('http://localhost/inherit-sibling/shared');

  assertExists(siblingResponse);
  assertEquals(siblingResponse.status, 200);
  assertEquals(siblingResponse.headers.get('x-base-middleware'), 'ran');
  assertEquals(siblingResponse.headers.get('x-sibling-middleware'), 'ran');
  assertEquals(siblingResponse.headers.get('x-child-middleware'), null);
  assertEquals(await siblingResponse.json(), {
    controller: 'sibling',
  });
  assertEquals(inheritedMiddlewareEvents, [
    'base:before',
    'sibling:before',
    'handler:sibling',
    'sibling:after',
    'base:after',
  ]);

  inheritedMiddlewareEvents.length = 0;

  const childApp = mountController(new ChildInheritedMiddlewareController() as unknown as ControllerClass);
  const childResponse = await childApp.request('http://localhost/inherit-child/shared');

  assertExists(childResponse);
  assertEquals(childResponse.status, 200);
  assertEquals(childResponse.headers.get('x-child-middleware'), 'ran');
  assertEquals(childResponse.headers.get('x-sibling-middleware'), null);
  assertEquals(inheritedMiddlewareEvents, [
    'base:before',
    'child:before',
    'handler:child',
    'child:after',
    'base:after',
  ]);
});

Deno.test('Controller handlers that return undefined leave the response untouched', async () => {
  const app = mountController(new UndefinedResultController() as unknown as ControllerClass);
  const response = await app.request('http://localhost/empty/noop');

  assertExists(response);
  assertEquals(response.status, 404);
});

Deno.test('Controller handlers resolve mapped args and append ctx as the final implicit parameter', async () => {
  const app = mountController(new MappedArgsController() as unknown as ControllerClass);
  const response = await app.request('http://localhost/mapped/123?dryRun=yes', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({ name: 'oakest' }),
  });

  assertExists(response);
  assertEquals(response.status, 200);
  assertEquals(await response.json(), {
    id: '123',
    bodyName: 'oakest',
    dryRun: 'yes',
    path: '/mapped/123',
  });
});

Deno.test('Controller handlers without explicit route arg mapping receive ctx as the only parameter', async () => {
  const app = mountController(new MappedArgsController() as unknown as ControllerClass);
  const response = await app.request('http://localhost/mapped');

  assertExists(response);
  assertEquals(response.status, 200);
  assertEquals(await response.json(), {
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

Deno.test('Controller handlers with multiple parameters require explicit route arg mapping', async () => {
  const app = mountController(new InvalidMappedController() as unknown as ControllerClass);
  const response = await app.request('http://localhost/invalid/broken');

  assertExists(response);
  assertEquals(response.status, 500);
});

Deno.test('sendResult() maps handler return values onto a Hono Response', async () => {
  const app = new Hono();

  app.get('/undefined', (c) => sendResult(c, undefined));
  app.get('/null', (c) => sendResult(c, null));
  app.get('/response', (c) => sendResult(c, new Response('custom', { status: 201 })));
  app.get('/string', (c) => sendResult(c, 'plain text'));
  app.get('/uint8array', (c) => sendResult(c, new TextEncoder().encode('bytes')));
  app.get('/arraybuffer', (c) => sendResult(c, new TextEncoder().encode('buffer').buffer));
  app.get('/object', (c) => sendResult(c, { ok: true }));

  const undefinedResponse = await app.request('/undefined');
  assertEquals(undefinedResponse.status, 404);

  // null is a deliberate JSON value, distinct from "no result" (undefined) — see sendResult()'s docstring.
  const nullResponse = await app.request('/null');
  assertEquals(nullResponse.status, 200);
  assertEquals(nullResponse.headers.get('content-type')?.includes('application/json'), true);
  assertEquals(await nullResponse.text(), 'null');

  const responseResponse = await app.request('/response');
  assertEquals(responseResponse.status, 201);
  assertEquals(await responseResponse.text(), 'custom');

  const stringResponse = await app.request('/string');
  assertEquals(stringResponse.status, 200);
  assertEquals(stringResponse.headers.get('content-type')?.includes('text/plain'), true);
  assertEquals(await stringResponse.text(), 'plain text');

  const uint8Response = await app.request('/uint8array');
  assertEquals(uint8Response.status, 200);
  assertEquals(await uint8Response.text(), 'bytes');

  const arrayBufferResponse = await app.request('/arraybuffer');
  assertEquals(arrayBufferResponse.status, 200);
  assertEquals(await arrayBufferResponse.text(), 'buffer');

  const objectResponse = await app.request('/object');
  assertEquals(objectResponse.status, 200);
  assertEquals(await objectResponse.json(), { ok: true });
});
