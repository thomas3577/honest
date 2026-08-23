# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.0-alpha.1] - 2026-08-22

Initial release: a decorator-driven application toolkit for [Hono](https://jsr.io/@hono/hono), ported from [oakest](https://github.com/thomas3577/oakest) (the same idea, built on Oak).

### Added

- Core decorator API: `@Controller`, `@Module`, `@Get`/`@Post`/`@Put`/`@Patch`/`@Delete`/`@All`, `@Injectable`.
- Explicit dependency injection via `inject(...)`, backed by `@needle-di/core`.
- Route argument resolvers: `req`, `ctx`, `res`, `next`, `query`, `param`, `body`, `headers`, `ip`, `custom`.
- Custom middleware decorators via `registerMiddlewareMethodDecorator`.
- `assignModule()` to compose a module tree into a `Hono` app.
- Schema validation resolvers `validatedBody`, `validatedQuery`, `validatedParam`, `validatedHeaders`, compatible with any [Standard Schema](https://standardschema.dev) implementation (Zod, Valibot, ArkType), with no added dependency.
- `HttpError` and `ValidationError` error types, and a ready-made `errorHandler()` for `app.onError()`.
- Proxy-aware `ip({ trustProxy: true })` option for reading `X-Forwarded-For` behind a trusted reverse proxy.
- `scoped()` resolver for request-scoped dependency injection, backed by a needle-di child container created once per request.
- OpenAPI documentation: `@ApiTags`, `@ApiOperation`, `@ApiResponse`, `@ApiExcludeEndpoint` decorators and `buildOpenApiDocument()`, which reads the module tree's existing decorator metadata (no controller/provider instantiation) into an OpenAPI 3.1 document. Request/response shapes backed by `validatedBody`/`validatedQuery`/`validatedParam`/`validatedHeaders` are included when a `schemaToJsonSchema` converter is supplied (e.g. Zod's `z.toJSONSchema`). Demo wires this up with [Scalar](https://github.com/scalar/scalar) at `/reference`.
- Module lifecycle hooks: implement `OnModuleInit`/`OnModuleDestroy` on a controller or provider, run via the new `initModule()`/`destroyModule()`, called explicitly around `assignModule()` (which stays synchronous). A provider is only eagerly built for this if it implements one of the hooks — providers that don't stay exactly as lazily-constructed as before.
- `Config(schema, source?)`: validates a config source (`Deno.env.toObject()` by default) against a Standard Schema synchronously at construction, exposing a typed `.value` with no cast needed at the call site (`class AppConfig extends Config(schema) {}`).
- `createTestApp()`, exported separately via `@dx/honest/testing`, builds an ad-hoc module and assigns it — removes the boilerplate of declaring a named module class per test.
- `healthCheck()`/`isModuleReady()`: a ready-made health/readiness route handler (and the underlying boolean check) reporting whether `initModule()` has completed and `destroyModule()` hasn't started — the shape orchestrators expect from a readiness probe.
- Guards: `@UseGuard(GuardClass)` gates a route, or (as a class decorator) every route on a controller, behind `GuardClass.canActivate(c)`. The guard is resolved through the request scope, so it can `inject()` module providers; denial throws a plain `HttpError(403)` unless the guard throws its own. Built on a new `registerMiddlewareClassDecorator()`, the class-level counterpart to the existing `registerMiddlewareMethodDecorator()`.
- Demo app (`demo/`) and full test suite covering the above.

### Fixed

_(found and fixed during the initial development of this version, before any external release)_

- Route and middleware metadata no longer leak between sibling subclasses of a shared base controller (both were mutating an array inherited via the class metadata prototype chain instead of cloning it).
- `query()`/`param()`/`body()`/`headers()` now throw immediately on non-string, non-nil data instead of silently discarding it; `custom()` preserves arbitrary payloads instead of running them through the same string-only normalization.
- Removed a dead middleware-metadata fallback branch and four unused `RouteParamTypes` enum members.
- `errorHandler()` no longer crashes on an `HttpError` with a no-body status (204/205/304) or an out-of-range status — `HttpError` now validates its status at construction instead.
- `validatedBody()` reports malformed JSON as a clean `ValidationError` (400) instead of letting a raw `SyntaxError` surface as a 500.
- `validatedQuery()` no longer silently collapses repeated query keys (`?ids=1&ids=2`) to their last value.
- The internal per-request scope context key uses a `Symbol` (matching every other internal metadata key in this codebase) instead of a plain string, to rule out collisions with a host app's own context variables.
- `buildOpenApiDocument()` no longer emits a duplicate, conflicting path parameter when a route combines a `:name` URL segment with `validatedParam()`.
- `buildOpenApiDocument()` correlates `@ApiOperation()`/`@ApiResponse()` to the exact method declaration instead of matching by name alone, so a subclass overriding a route under the same method name with a different path/HTTP method no longer gets the wrong route's documentation.
- `buildOpenApiDocument()` recognizes Hono's constrained path-param syntax (`:id{[0-9]+}`) instead of leaving the constraint in the generated OpenAPI path.
- `buildOpenApiDocument()`'s module-tree walk is now shared with `assignModule()` (`walkModuleTree()`) instead of a separate, duplicated traversal.
- The README's "swap an implementation by environment" example didn't actually work — it injected the concrete `UserService` class while the module's `providers` could list `MockUserService` instead, which needle-di can't resolve for that token (`No provider(s) found for UserService`). Fixed to use an explicit `implementing` token, which is what actually lets one provider stand in for another.
- `initModule()` ran lifecycle hooks on controllers before providers, so a controller injecting a lifecycle-implementing provider (e.g. a `DbConnection`) could run its own `onModuleInit()` before that provider had finished initializing. Providers now run first, and `destroyModule()`'s reverse order tears controllers down before providers.
- `Config()` no longer leaves an unhandled promise rejection behind when a schema validates asynchronously and that promise later rejects (it was already rejected as unsupported, but the dangling promise itself was never handled).
- The provider lifecycle-hook check in `assignModule()` now reuses the same `hasOnModuleInit`/`hasOnModuleDestroy` guards `initModule()`/`destroyModule()` use, instead of a second, separately-maintained check.
- `Controller()` read class-level middleware (used by `@UseGuard()` on a controller) from the wrong prototype — a class decorator applied _above_ `@Controller()` (the natural-looking order) receives `@Controller()`'s already-wrapped class as its target, which `@Controller()`'s own closure could never see, so the middleware was silently never applied regardless of decoration order. Fixed to read from the instance's actual, fully-decorated prototype at call time instead of the decoration-time closure.

[0.1.0-alpha.1]: https://github.com/thomas3577/honest/releases/tag/v0.1.0-alpha.1
