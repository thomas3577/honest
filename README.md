# Honest

[![JSR Version](https://jsr.io/badges/@dx/honest)](https://jsr.io/@dx/honest)
[![ci](https://github.com/thomas3577/honest/actions/workflows/deno.yml/badge.svg)](https://github.com/thomas3577/honest/actions/workflows/deno.yml)

> ⚠️ **EXPERIMENTAL**: This library is in early development and highly experimental. APIs may change without notice. Not recommended for production use.

Honest is a decorator-driven application toolkit for Deno's [Hono](https://jsr.io/@hono/hono).

It provides controllers, modules, explicit dependency injection, middleware decorators, and route argument resolvers in a small API surface built around standard decorators.

Honest is the same idea as [oakest](https://github.com/thomas3577/oakest) — a decorator-driven, NestJS-like toolkit — but built on Hono instead of [Oak](https://jsr.io/@oak/oak). See [Differences from oakest](#differences-from-oakest) below if you know oakest already.

## Highlights

- **Controllers and Modules**: Organize Hono routes in a clear application structure.
- **Explicit Dependency Injection**: Declare dependencies with `inject(...)` instead of emitted type metadata.
- **Standard Decorators**: Build on the current TC39 decorator model instead of legacy experimental decorators.
- **Middleware Decorators**: Attach reusable request guards and flow control directly to route methods.
- **Route Argument Resolvers**: Map params, body, query, headers, request, response, context, or custom values directly on route decorators.

## Quick Start

Define controllers to handle HTTP endpoints

```typescript
// ./controllers/util-controller.ts
import { Controller, Get, headers, query } from '@dx/honest';

@Controller('util')
export class UtilController {
  @Get('user-agent', [headers<string>('user-agent')])
  bounceUserAgent(userAgent: string) {
    return { status: 'ok', userAgent };
  }

  @Get('multiply', [query<string>('f1'), query<string>('f2')])
  getRandomStuff(factor1: string, factor2: string) {
    return { status: 'ok', result: Number(factor1) * Number(factor2) };
  }
}
```

Define modules

```typescript
// ./app.module.ts
import { Module } from '@dx/honest';
import { UtilController } from './controllers/util-controller.ts';

@Module({
  controllers: [UtilController],
  routePrefix: 'api/v1',
  modules: [], // optional submodules
})
export class AppModule {}
```

Register an app module with Hono.

```typescript
// ./main.ts
import { Hono } from 'hono';
import { assignModule } from '@dx/honest';
import { AppModule } from './app.module.ts';

const app = new Hono();
app.route('/', assignModule(AppModule));

Deno.serve(app.fetch);
```

Run your app and the following endpoints will be available:

- `/api/v1/util/user-agent`
- `/api/v1/util/multiply?f1=2&f2=4`

## Differences from oakest

Honest mirrors oakest's decorator API almost 1:1, but Hono's request-handling model is architecturally different from Oak's, which shows up in a few places:

- **`assignModule()` returns a Hono app, not a middleware.** Oak's `assignModule()` returned a `Middleware` you passed to `app.use(...)`. Hono routers and apps are the same kind of object, so `assignModule()` now returns a full `Hono` instance — mount it with `app.route('/', assignModule(AppModule))` (or use it directly as your root app / fetch handler).
- **`res()` is an alias for `ctx()`.** Hono has no separate mutable response object like Oak's `context.response` — everything is expressed by what the handler returns. Both `res()` and `ctx()` resolve to the same Hono `Context`; prefer `ctx()` in new code.
- **Handler return values are mapped to a response automatically:**

  | Return value                 | Response                                       |
  | :--------------------------- | :--------------------------------------------- |
  | `undefined`                  | 404 (via `c.notFound()`) — "nothing to send"   |
  | `null`                       | JSON `null`, status 200 — a deliberate value   |
  | a `Response` instance        | returned as-is (escape hatch for full control) |
  | `string`                     | `text/plain` via `c.text(...)`                 |
  | `Uint8Array` / `ArrayBuffer` | raw body via `c.body(...)`                     |
  | anything else                | JSON via `c.json(...)`                         |

  Only `undefined` means "no result" — `null` is valid, serializable JSON and is sent as such.

- **`ip()` requires Deno's connection info.** Hono has no built-in client IP like Oak's `request.ip`. Honest's `ip()` resolver lazily loads Hono's Deno adapter (`getConnInfo` from `hono/deno`, only when `ip()` is actually used) and resolves to `''` when no real connection is available (for example, when calling routes in tests via `app.request()` instead of a real `Deno.serve`).
- **Middleware short-circuits by returning a `Response`, not by mutating-then-returning.** Oak middleware denied a request by mutating `context.response` and returning `void`. Hono middleware denies a request by `return`ing a `Response` directly instead of calling `next()` — see [Custom Middleware Decorators](#custom-middleware-decorators) below.
- **Errors fall back to Hono's default `onError` behavior.** Honest doesn't install a custom error handler, so an uncaught error in a handler or middleware produces Hono's default 500 response. If you want your own error shape, register `app.onError(...)` on your top-level app:

  ```typescript
  import { Hono } from 'hono';
  import { assignModule } from '@dx/honest';
  import { AppModule } from './app.module.ts';

  const app = new Hono();
  app.route('/', assignModule(AppModule));
  app.onError((err, c) => {
    console.error(err);
    return c.json({ error: 'Internal Server Error' }, 500);
  });

  Deno.serve(app.fetch);
  ```

## API Overview

### Modules

A module is a class annotated with a `@Module()` decorator. The `@Module()` decorator provides metadata that the application makes use of to organize the application structure.
Each application has at least one module, a root module, and each modules can have child modules.

The `@Module()` decorator takes those options:

| name          | description                                                                 |
| :------------ | :-------------------------------------------------------------------------- |
| `controllers` | the set of controllers defined in this module which have to be instantiated |
| `providers`   | the providers that will be instantiated by the injector                     |
| `modules`     | the set of modules defined as child modules of this module                  |
| `routePrefix` | the prefix name to be set in route as the common URL for controllers.       |

```typescript
import { Module } from '@dx/honest';
import { AppController } from './app.controller.ts';
import { SampleModule } from './sample/sample.module.ts';

@Module({
  modules: [SampleModule],
  controllers: [AppController],
  routePrefix: 'v1',
})
export class AppModule {}
```

### Controllers

#### Routing

A controller is a class annotated with a `@Controller()` decorator. Controllers are responsible for handling incoming requests and returning responses to the client.
The `@Controller()` decorator takes an optional route path prefix.

```typescript
import { Controller, Get } from '@dx/honest';

@Controller('sample')
export class UsersController {
  @Get()
  findAll(): string {
    return 'OK';
  }
}
```

The `@Get()` HTTP request method decorator before the `findAll()` method tells the application to create a handler for a specific endpoint for HTTP requests.

For http methods, you can use `@Get()`, `@Post()`, `@Put()`, `@Patch()`, `@Delete()`, `@All()`.

#### Route arguments

Handlers can map request-derived values directly on the HTTP method decorator.

```typescript
import { Controller, Get, headers, param, query } from '@dx/honest';

@Controller('sample')
export class SampleController {
  @Get(':id', [param<string>('id'), query<string | null>('dryRun'), headers<string>('user-agent')])
  findOne(id: string, dryRun: string | null, userAgent: string) {
    return { id, dryRun, userAgent };
  }
}
```

Available resolvers:

| name                     | result                                                                  |
| :----------------------- | :---------------------------------------------------------------------- |
| `req()`                  | `c.req` (the Hono request)                                              |
| `res()`                  | alias for `ctx()` (Hono has no separate response object)                |
| `next()`                 | Hono `next` handler                                                     |
| `query(key?)`            | `URLSearchParams` or a single query value                               |
| `param(key?)`            | route params object or a single route param                             |
| `body(key?)`             | parsed JSON body or a single body property                              |
| `headers(name?)`         | all headers as an object or a single header value                       |
| `ip()`                   | client IP (Deno only, via `hono/deno`'s `getConnInfo`; `''` if unknown) |
| `ctx()`                  | the full Hono `Context`                                                 |
| `custom(handler, data?)` | custom async/sync value resolver, typed from the handler return value   |

`key?`/`name?` on the lookup resolvers (`query`, `param`, `body`, `headers`) must be a string or omitted — passing anything else throws a `TypeError` immediately at decoration time, rather than silently resolving to "no key" at request time. `custom(handler, data?)` is the exception: `data` is a free-form payload passed through to `handler` unchanged, so it accepts any value.

If the handler declares exactly one parameter and no resolver array, Honest still injects `ctx` automatically.

If the handler uses a resolver array and declares exactly one extra trailing parameter, that final parameter receives `ctx` automatically.

### Providers

Providers are responsible for main business logic as services, repositories, factories, helpers, and so on.
The main idea of a provider is that it can be injected as a dependency. Depending on the environment, different implementations of a service can be provided.

```typescript
// ./sample.service.ts
import { Injectable } from '@dx/honest';
import db from './db-service.ts';

@Injectable()
export class UserService {
  async getAllUsers() {
    const { data: users } = await db.users.getAll();
    return { status: 'ok', data: users };
  }
}

@Injectable()
export class MockUserService {
  getAllUsers() {
    return {
      status: 'ok',
      data: [
        {
          name: 'John Doe',
        },
        {
          name: 'Jane Doe',
        },
      ],
    };
  }
}

// ./sample.controller.ts
import { Controller, Get, inject } from '@dx/honest';
import { UserService } from './sample.service.ts';

@Controller('users')
export class UsersController {
  constructor(private readonly userService = inject(UserService)) {}

  @Get()
  getAllUsers() {
    return this.userService.getAllUsers();
  }
}

// ./sample.module.ts
import { Module } from '@dx/honest';
import { UsersController } from './sample.controller.ts';
import { MockUserService, UserService } from './sample.service.ts';

@Module({
  controllers: [UsersController],
  providers: [
    Deno.env.get('DENO_ENV') === 'production' ? UserService : MockUserService,
  ],
})
export class SampleModule {}
```

Dependency injection notes:

- Dependencies must be requested explicitly in constructor default values.
- Providers still need to be registered in your module's `providers` array.
- `@Injectable({ implementing: TOKEN })` can still be used to bind string or symbol tokens and resolve them with `inject<T>(TOKEN)`.
- `isSingleton: false` is no longer supported in this Needle-based mode.
- `experimentalDecorators` is not needed in `deno.json`.

### Custom Middleware Decorators

It's possible to register middleware that can be used in controllers by means of decorators.

For instance, to protect routes based on user roles, you can create a `@RequiresRole` middleware decorator.

```typescript
// ./middleware.ts
import { registerMiddlewareMethodDecorator } from '@dx/honest';
import type { Context } from 'hono';

function checkUserRoles(c: Context, roles: string[]) {
  // Logic to check the user role
  return false;
}

export function RequiresRole(roles: string[]) {
  return function (_value, context) {
    const requiresRole = async (c: Context, next: () => Promise<unknown>) => {
      // Logic to check the user session or JWT for the required role
      if (checkUserRoles(c, roles)) {
        await next();
      } else {
        // Short-circuit by returning a Response instead of calling next()
        return c.json({ error: 'Unauthorized' }, 401);
      }
    };
    registerMiddlewareMethodDecorator(context, requiresRole);
  };
}
```

Then you can use the `@RequiresRole` decorator in your controllers' methods.

```typescript
// ./sample.controller.ts
import { Controller, Get } from '@dx/honest';
import { RequiresRole } from './middleware.ts';

@Controller('users')
export class SampleController {
  @Get('/')
  @RequiresRole(['admin'])
  getAllUsers() {
    // Logic to get all users
  }
}
```

### Custom route argument resolvers

Custom route inputs can be declared inline with `custom(...)`. The resolver type is inferred from the handler return value.

```typescript
import { Controller, custom, Get } from '@dx/honest';

@Controller('users')
export class UsersController {
  @Get('me', [custom((c) => c.get('jwtData')?.sub)])
  getCurrentUser(userId: string | undefined) {
    return { userId };
  }
}
```

Resolvers can be asynchronous too:

```typescript
import { Controller, custom, Get } from '@dx/honest';

@Controller('products')
export class ProductsController {
  @Get('recent', [custom(async (c) => {
    const sid = c.get('jwtData')?.sid;
    return sid ? await retrieveSession(sid) : null;
  })])
  getRecentProducts(sessionData: { recentProducts: unknown[] } | null) {
    return sessionData?.recentProducts ?? [];
  }
}
```
