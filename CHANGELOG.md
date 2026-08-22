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

[0.1.0-alpha.1]: https://github.com/thomas3577/honest/releases/tag/v0.1.0-alpha.1
