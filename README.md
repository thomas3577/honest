# Honest

[![JSR Version](https://jsr.io/badges/@dx/honest)](https://jsr.io/@dx/honest)
[![ci](https://github.com/thomas3577/honest/actions/workflows/deno.yml/badge.svg)](https://github.com/thomas3577/honest/actions/workflows/deno.yml)

> ⚠️ **EXPERIMENTAL**: This library is in early development and highly experimental. APIs may change without notice. Not recommended for production use.

Honest is a decorator-driven application toolkit for Deno's [Hono](https://jsr.io/@hono/hono). It provides controllers, modules, explicit dependency injection, middleware decorators, and route argument resolvers in a small API surface built around standard decorators.

Honest is the same idea as [oakest](https://github.com/thomas3577/oakest) — a decorator-driven, NestJS-like toolkit — but built on Hono instead of [Oak](https://jsr.io/@oak/oak). See [Differences from oakest](#differences-from-oakest) at the end if you know oakest already.

**Compatibility:** requires Hono `^4.13.3`. Honest's own `deno.json` declares this as a version range, not an exact pin, so Deno can resolve it to the same Hono install your own project already uses wherever possible — keep your project on a single resolved Hono version. Mixing two different Hono versions in one project can produce confusing `Context is not assignable to Context`-style TypeScript errors, since Hono's classes use private fields that make two separately-resolved copies of the same version nominally incompatible.

## Contents

- [Highlights](#highlights)
- [Quick Start](#quick-start)
- [API Overview](#api-overview)
  - [Modules](#modules)
  - [Controllers](#controllers)
  - [Route Arguments](#route-arguments)
  - [Providers](#providers)
  - [Custom Middleware Decorators](#custom-middleware-decorators)
  - [Custom Route Argument Resolvers](#custom-route-argument-resolvers)
- [Advanced Features](#advanced-features)
  - [Validation](#validation)
  - [Request Scope](#request-scope)
  - [Error Handling](#error-handling)
  - [OpenAPI Documentation](#openapi-documentation)
  - [Production Hardening](#production-hardening)
- [Differences from oakest](#differences-from-oakest)

## Highlights

- **Controllers and Modules**: Organize Hono routes in a clear application structure.
- **Explicit Dependency Injection**: Declare dependencies with `inject(...)` instead of emitted type metadata.
- **Standard Decorators**: Build on the current TC39 decorator model instead of legacy experimental decorators.
- **Middleware Decorators**: Attach reusable request guards and flow control directly to route methods.
- **Route Argument Resolvers**: Map params, body, query, headers, request, response, context, or custom values directly on route decorators.
- **Schema Validation**: Validate the body, query, params, or headers against any [Standard Schema](https://standardschema.dev)-compatible library (Zod, Valibot, ArkType) with no added dependency.
- **Built-in Error Handling**: A ready-made `errorHandler()` turns thrown errors into clean, consistent responses.
- **Request Scope**: Opt in to a fresh, per-request instance for values that shouldn't be long-lived singletons.
- **OpenAPI Documentation**: `@ApiTags`/`@ApiOperation`/`@ApiResponse` decorators plus `buildOpenApiDocument()` generate a real OpenAPI 3.1 document — pair it with [Scalar](https://github.com/scalar/scalar) for an interactive API reference, no Swagger/Nest dependency required.

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

### Route Arguments

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

| name                       | result                                                                        |
| :------------------------- | :---------------------------------------------------------------------------- |
| `req()`                    | `c.req` (the Hono request)                                                    |
| `res()`                    | alias for `ctx()` (Hono has no separate response object)                      |
| `next()`                   | Hono `next` handler                                                           |
| `query(key?)`              | `URLSearchParams` or a single query value                                     |
| `param(key?)`              | route params object or a single route param                                   |
| `body(key?)`               | parsed JSON body or a single body property                                    |
| `headers(name?)`           | all headers as an object or a single header value                             |
| `ip(options?)`             | client IP (Deno only, via `hono/deno`'s `getConnInfo`; `''` if unknown)       |
| `ctx()`                    | the full Hono `Context`                                                       |
| `custom(handler, data?)`   | custom async/sync value resolver, typed from the handler return value         |
| `scoped(Provider)`         | a request-scoped instance of `Provider` — see [Request Scope](#request-scope) |
| `validatedBody(schema)`    | the JSON body, validated against a schema — see [Validation](#validation)     |
| `validatedQuery(schema)`   | the query string, validated against a schema — see [Validation](#validation)  |
| `validatedParam(schema)`   | the route params, validated against a schema — see [Validation](#validation)  |
| `validatedHeaders(schema)` | the headers, validated against a schema — see [Validation](#validation)       |

Notes on resolver arguments:

- `ip()` accepts an optional `{ trustProxy?: boolean }`. It defaults to `false` (uses the raw connection address); pass `{ trustProxy: true }` to prefer `X-Forwarded-For` when running behind a reverse proxy/load balancer you control — don't enable it otherwise, since that header is client-spoofable.
- `key?`/`name?` on the lookup resolvers (`query`, `param`, `body`, `headers`) must be a string or omitted — passing anything else throws a `TypeError` immediately at decoration time, rather than silently resolving to "no key" at request time. `custom(handler, data?)` is the exception: `data` is a free-form payload passed through to `handler` unchanged, so it accepts any value.
- If the handler declares exactly one parameter and no resolver array, Honest still injects `ctx` automatically.
- If the handler uses a resolver array and declares exactly one extra trailing parameter, that final parameter receives `ctx` automatically.

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
- Constructor `inject(...)` always resolves against long-lived singletons, built once when the app starts. For a value that must be fresh per request instead, use the `scoped()` resolver — see [Request Scope](#request-scope).

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

### Custom Route Argument Resolvers

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

## Advanced Features

### Validation

`validatedBody(schema)`, `validatedQuery(schema)`, `validatedParam(schema)`, and `validatedHeaders(schema)` validate the JSON body, query string, route params, or headers against any schema implementing the [Standard Schema](https://standardschema.dev) interface — Zod (>=3.24), Valibot, and ArkType all work out of the box, and honest doesn't depend on any of them. On failure they throw `ValidationError`, which `errorHandler()` (see [Error Handling](#error-handling)) turns into a `400` response with the schema's issues. Malformed JSON in `validatedBody()` is reported the same way, not as a 500. Repeated query keys (`?ids=1&ids=2`) are preserved as a string array by `validatedQuery()` instead of being collapsed to the last value.

```typescript
import { Controller, Post, validatedBody } from '@dx/honest';
import { z } from 'zod';

const CreateUserSchema = z.object({ name: z.string(), email: z.string().email() });

@Controller('users')
export class UsersController {
  @Post([validatedBody(CreateUserSchema)])
  create(user: z.infer<typeof CreateUserSchema>) {
    return { status: 'ok', user };
  }
}
```

### Request Scope

Controllers and providers are built once per `assignModule()` call, not per request — constructor `inject(...)` always resolves against those long-lived singletons. For values that genuinely need to be fresh per request (e.g. a unit-of-work or a per-request cache), use the `scoped()` resolver instead of constructor injection:

```typescript
import { Controller, Get, inject, scoped } from '@dx/honest';
import { DbConnection } from './db-connection.ts'; // a regular, singleton provider

export class UnitOfWork {
  // scoped() classes can still inject() the module's singletons — only
  // UnitOfWork itself is fresh per request.
  constructor(readonly db = inject(DbConnection)) {}
}

@Controller('orders')
export class OrdersController {
  @Get(':id', [scoped(UnitOfWork)])
  findOne(unitOfWork: UnitOfWork) {
    return unitOfWork.db.query(/* ... */);
  }
}
```

`scoped()` is backed by a real needle-di child container, created once per request by `assignModule()`'s own middleware — repeated `scoped()` calls within the same request return the same instance, and a fresh one is used for the next request. It only works on controllers mounted via `assignModule()`; calling it on a controller test-mounted by hand throws a clear error. This is an opt-in mechanism scoped to the resolver argument list — it doesn't change how constructor `inject(...)` works anywhere else.

### Error Handling

Honest ships a ready-made `app.onError()` handler instead of a copy-paste recipe: `errorHandler()` maps `ValidationError` (thrown by the validation resolvers above) to a `400` with the schema's issues, `HttpError` to its own status/details, and anything else to a logged, generic `500`.

```typescript
import { Hono } from 'hono';
import { assignModule, errorHandler, HttpError } from '@dx/honest';
import { AppModule } from './app.module.ts';

const app = new Hono();
app.route('/', assignModule(AppModule));
app.onError(errorHandler());

Deno.serve(app.fetch);
```

Throw `HttpError(status, message, details?)` from a handler, provider, or middleware to produce a specific response through the same handler:

```typescript
import { Get, HttpError } from '@dx/honest';

@Get(':id')
findOne(id: string) {
  const item = this.service.find(id);
  if (!item) throw new HttpError(404, 'Not found', { id });
  return item;
}
```

`HttpError`'s status is validated when constructed: it must be an integer between 100 and 599, and can't be a status that isn't allowed to carry a body (101, 204, 205, 304) — since `HttpError` always renders one.

### OpenAPI Documentation

Like `@nestjs/swagger`, but without a Swagger/Nest dependency: `@ApiTags`, `@ApiOperation`, and `@ApiResponse` attach descriptive OpenAPI metadata to a controller, and `buildOpenApiDocument()` turns the whole module tree into a real OpenAPI 3.1 document — read purely from the same decorator metadata the router already uses, without instantiating any controller or provider.

```typescript
import { ApiOperation, ApiResponse, ApiTags, Controller, Get, param } from '@dx/honest';

@ApiTags('users')
@Controller('users')
export class UsersController {
  @ApiOperation({ summary: 'Get a user by id' })
  @ApiResponse({ status: 200, description: 'The user' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @Get(':id', [param<string>('id')])
  findOne(id: string) {
    return this.service.find(id);
  }
}
```

```typescript
// ./main.ts
import { buildOpenApiDocument } from '@dx/honest';
import { AppModule } from './app.module.ts';

const document = buildOpenApiDocument(AppModule, {
  info: { title: 'My API', version: '1.0.0' },
});

app.get('/openapi.json', (c) => c.json(document));
```

Request/response shapes backed by `validatedBody`/`validatedQuery`/`validatedParam`/`validatedHeaders` (see [Validation](#validation)) are only included if you pass a `schemaToJsonSchema` converter — honest has no built-in Standard Schema → JSON Schema conversion, since that would tie it to one schema library. Use the schema library's own converter, e.g. Zod's built-in `z.toJSONSchema`:

```typescript
import { z } from 'zod';

const document = buildOpenApiDocument(AppModule, {
  info: { title: 'My API', version: '1.0.0' },
  schemaToJsonSchema: (schema) => z.toJSONSchema(schema as z.ZodType),
});
```

Without a converter, everything else still works — tags, summaries, descriptions, responses, path/query/header parameters declared via plain `param()`/`query()`/`headers()`, and route exclusion via `@ApiExcludeEndpoint()`. Routes registered with `@All()` have no single OpenAPI method equivalent and are skipped.

Serve the document with [Scalar](https://github.com/scalar/scalar) for an interactive UI — like [Production Hardening](#production-hardening) below, this is plain Hono middleware, no honest-specific wiring:

```typescript
import { Scalar } from 'npm:@scalar/hono-api-reference@0.11.16';

app.get('/reference', Scalar({ url: '/openapi.json' }));
```

That's a plain `npm:` specifier, not an entry in honest's own `imports` — Scalar is entirely optional and only pulled in if (and where) you actually import it. Add a bare `"@scalar/hono-api-reference": "npm:@scalar/hono-api-reference@..."` to your own `deno.json` if you'd rather use the short specifier.

### Production Hardening

None of the following needs any honest-specific code — `assignModule()` returns a plain `Hono` instance, so Hono's own middleware (and the wider Hono ecosystem) applies directly, before you mount your module:

```typescript
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { assignModule, errorHandler } from '@dx/honest';
import { AppModule } from './app.module.ts';

const app = new Hono();
app.use(cors({ origin: 'https://example.com' }));
app.use(secureHeaders());
app.route('/', assignModule(AppModule));
app.onError(errorHandler());

Deno.serve(app.fetch);
```

For rate limiting, use a Hono-compatible middleware package (e.g. `hono-rate-limiter`) the same way. None of this is bundled with honest itself — it's plain Hono middleware, applied to the app `assignModule()` gives you.

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
- **Middleware short-circuits by returning a `Response`, not by mutating-then-returning.** Oak middleware denied a request by mutating `context.response` and returning `void`. Hono middleware denies a request by `return`ing a `Response` directly instead of calling `next()` — see [Custom Middleware Decorators](#custom-middleware-decorators) above.
- **Errors fall back to Hono's default `onError` behavior unless you install `errorHandler()`.** See [Error Handling](#error-handling) above.
