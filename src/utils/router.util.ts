import { Hono } from 'hono';
import type { Context } from 'hono';

import { MIDDLEWARE_METADATA, MODULE_METADATA } from '../const.ts';
import type { ClassConstructor, ControllerClass, CreateRouterOption, MiddlewareHandler, OnModuleDestroy, OnModuleInit } from '../types.ts';
import { createInjector, type NeedleInjector } from './injector.util.ts';
import { defineMetadata, getMetadata } from './metadata.util.ts';

type DecoratorMetadataBag = Record<PropertyKey, unknown>;
type MiddlewareRegistration = { functionName: string; handler: MiddlewareHandler };

/**
 * A real Symbol, not a string: Hono's `c.set()`/`c.get()` types only accept
 * `Record<string, any>` keys, so this already needs an `as never` cast
 * below regardless of the key's runtime type (the underlying `Context`
 * variable store is a plain `Map`, which accepts any key) — using a Symbol
 * here, like every other internal metadata key in this codebase
 * (const.ts), rules out a host app's own `c.set('requestScope', ...)`
 * silently colliding with honest's internal state.
 */
const REQUEST_SCOPE_KEY = Symbol('requestScope');

/**
 * Stores the per-request child injector on `c` for `assignModule()`.
 * Hono's `c.set()`/`c.get()` types are keyed off the app's `Variables`
 * generic, which honest deliberately doesn't require consumers to declare
 * just for this internal mechanism — the `as never` cast is contained to
 * these two small, typed helper functions instead of a global
 * `ContextVariableMap` augmentation (which JSR's `no-slow-types` rule
 * disallows for published packages).
 */
export function setRequestScope(c: Context, scope: NeedleInjector): void {
  c.set(REQUEST_SCOPE_KEY as never, scope as never);
}

/** Reads the per-request child injector set by `setRequestScope()`, if any. */
export function getRequestScope(c: Context): NeedleInjector | undefined {
  return c.get(REQUEST_SCOPE_KEY as never) as NeedleInjector | undefined;
}

interface ModuleLifecycle {
  instances: object[];
  ready: boolean;
}

/**
 * Tracks the controller/provider instances built by one `assignModule()`
 * call, keyed by the `Hono` instance it returned — the same
 * WeakMap-keyed-by-the-object-itself approach as `setRequestScope()`/`getRequestScope()`
 * above, chosen for the same reason: `assignModule()`'s own return type
 * stays a plain `Hono`, so existing usage (`app.route('/', assignModule(AppModule))`)
 * is unaffected by consumers who never call `initModule()`/`destroyModule()`.
 */
const MODULE_LIFECYCLE = new WeakMap<Hono, ModuleLifecycle>();

const hasOnModuleInit = (instance: object): instance is OnModuleInit => typeof (instance as Partial<OnModuleInit>).onModuleInit === 'function';
const hasOnModuleDestroy = (instance: object): instance is OnModuleDestroy => typeof (instance as Partial<OnModuleDestroy>).onModuleDestroy === 'function';

const getModuleLifecycle = (app: Hono): ModuleLifecycle => {
  const lifecycle = MODULE_LIFECYCLE.get(app);

  if (!lifecycle) {
    throw new Error('initModule()/destroyModule()/isModuleReady()/healthCheck() must be called with the exact Hono instance returned by assignModule().');
  }

  return lifecycle;
};

/**
 * Runs `onModuleInit()` on every controller/provider instance in the module
 * tree `assignModule()` built for `app`, in the order those instances were
 * resolved (lifecycle-implementing providers, then controllers — see
 * `assignModule()` — so a provider like a DB connection has already run
 * its own `onModuleInit()` by the time a controller that injects it runs
 * its). Stops and propagates on the first error. Await this before
 * serving traffic:
 *
 * ```ts
 * const app = new Hono();
 * const honestApp = assignModule(AppModule);
 * app.route('/', honestApp);
 * await initModule(honestApp);
 * Deno.serve(app.fetch);
 * ```
 */
export async function initModule(app: Hono): Promise<void> {
  const lifecycle = getModuleLifecycle(app);

  for (const instance of lifecycle.instances) {
    if (hasOnModuleInit(instance)) {
      await instance.onModuleInit();
    }
  }

  lifecycle.ready = true;
}

/**
 * Runs `onModuleDestroy()` on every controller/provider instance in the
 * module tree `assignModule()` built for `app`, in the reverse of their
 * resolution order. Stops and propagates on the first error. Not wired to
 * any signal automatically — call it from your own shutdown handling:
 *
 * ```ts
 * Deno.addSignalListener('SIGINT', async () => {
 *   await destroyModule(honestApp);
 *   Deno.exit(0);
 * });
 * ```
 */
export async function destroyModule(app: Hono): Promise<void> {
  const lifecycle = getModuleLifecycle(app);

  // Flipped before running any hook, not after — once shutdown has started,
  // isModuleReady()/healthCheck() should stop advertising the app as
  // healthy immediately, not only once every teardown hook has finished.
  lifecycle.ready = false;

  for (const instance of [...lifecycle.instances].reverse()) {
    if (hasOnModuleDestroy(instance)) {
      await instance.onModuleDestroy();
    }
  }
}

/** Reports whether `initModule(app)` has completed (and `destroyModule(app)` has not since started) — see `healthCheck()` for a ready-made route handler. */
export function isModuleReady(app: Hono): boolean {
  return getModuleLifecycle(app).ready;
}

/**
 * A ready-made health/readiness route handler: `200` once `initModule(app)`
 * has completed, `503` before that or once `destroyModule(app)` has
 * started — the shape orchestrators (Kubernetes, load balancers) expect
 * from a health/readiness probe.
 *
 * ```ts
 * const honestApp = assignModule(AppModule);
 * app.route('/', honestApp);
 * app.get('/health', healthCheck(honestApp));
 * await initModule(honestApp);
 * ```
 *
 * Need a different response shape (uptime, version, dependency checks)?
 * Call `isModuleReady(app)` directly inside your own handler instead.
 */
export function healthCheck(app: Hono): (c: Context) => Response {
  return (c: Context) => {
    const ready = isModuleReady(app);

    return c.json({ status: ready ? 'ok' : 'unavailable' }, ready ? 200 : 503);
  };
}

export const isUndefined = (obj: unknown): obj is undefined => typeof obj === 'undefined';
export const isString = (fn: unknown): fn is string => typeof fn === 'string';
export const isNil = (obj: unknown): obj is null | undefined => isUndefined(obj) || obj === null;

export const mergeRoutePrefix = (prefix?: string, routePrefix?: string): string | undefined => {
  const normalizedPrefix = prefix?.replace(/\/+$/, '');
  const normalizedRoutePrefix = routePrefix?.replace(/^\/+/, '');

  if (normalizedPrefix && normalizedRoutePrefix) {
    return `${normalizedPrefix}/${normalizedRoutePrefix}`;
  }

  return normalizedPrefix || normalizedRoutePrefix;
};

const getModuleOptions = (module: ClassConstructor): CreateRouterOption => {
  const moduleOption = getMetadata(MODULE_METADATA, module.prototype) as CreateRouterOption | undefined;

  if (!moduleOption) {
    throw new Error(`Module ${module.name || '<anonymous>'} is missing @Module() metadata.`);
  }

  return moduleOption;
};

/**
 * Walks a module tree (depth-first, same order `assignModule()` mounts
 * routes in), deduping controllers already visited via `controllerTargets`,
 * and calls `visitController` once per not-yet-visited controller with its
 * fully merged route prefix. Shared by `assignModule()` (which resolves and
 * mounts each controller) and `buildOpenApiDocument()` (which only needs
 * the merged prefixes) so the two can never disagree on how prefixes
 * combine across nested modules.
 */
export function walkModuleTree(module: ClassConstructor, prefix: string | undefined, controllerTargets: Set<ClassConstructor>, visitController: (Controller: ClassConstructor, prefixFull: string | undefined) => void): void {
  const moduleOption = getModuleOptions(module);
  const prefixFull = mergeRoutePrefix(prefix, moduleOption.routePrefix);

  moduleOption.controllers?.forEach((Controller) => {
    if (controllerTargets.has(Controller)) {
      return;
    }

    controllerTargets.add(Controller);
    visitController(Controller, prefixFull);
  });

  moduleOption.modules?.forEach((subModule) => walkModuleTree(subModule, prefixFull, controllerTargets, visitController));
}

const getProviders = (module: ClassConstructor, providers: ClassConstructor[] = []): ClassConstructor[] => {
  const moduleOption = getModuleOptions(module);

  providers = [...providers, ...(moduleOption.providers || [])];

  moduleOption.modules?.forEach((subModule) => {
    providers = getProviders(subModule, providers);
  });

  return [...new Set(providers)];
};

/**
 * Assigns a module to a Hono app.
 *
 * @param {ClassConstructor} module - the module to assign
 *
 * @returns {Hono} the assembled Hono app for the module tree, ready to be mounted via `app.route(path, assignModule(Module))`
 */
export const assignModule = (module: ClassConstructor): Hono => {
  const providers = getProviders(module);
  const injector = createInjector(providers);
  const router = new Hono();
  const instances: object[] = [];

  // Registered before any controller routes are mounted below, since Hono
  // executes middleware/routes in registration order — a request-scope
  // must exist before any route (or its own middleware) can read it.
  router.use('*', async (c, next) => {
    setRequestScope(c, injector.createScope());
    await next();
  });

  // Resolved before controllers below, so that a provider's onModuleInit()
  // (e.g. opening a DB connection pool) has already run by the time a
  // controller that injects it runs its own — see initModule(). Providers
  // stay lazily-constructed by default (only built when actually injected
  // somewhere) — eagerly resolving every provider here would change that
  // for everyone. Only providers that implement a lifecycle hook are
  // eager-resolved, since that's the only way to guarantee the hook
  // actually runs; checked on the prototype, so this never instantiates a
  // provider that doesn't ask for it.
  providers.forEach((provider) => {
    if (hasOnModuleInit(provider.prototype) || hasOnModuleDestroy(provider.prototype)) {
      instances.push(injector.resolve(provider));
    }
  });

  walkModuleTree(module, undefined, new Set<ClassConstructor>(), (Controller, prefixFull) => {
    const controller: ControllerClass = injector.resolve(Controller as ClassConstructor<ControllerClass>);
    controller.init(prefixFull);
    instances.push(controller);

    const { path, route } = controller;

    if (!route) {
      throw new Error(`Controller ${Controller.name} has no route defined.`);
    }

    router.route(path && path.length > 0 ? path : '/', route);
  });

  MODULE_LIFECYCLE.set(router, { instances, ready: false });

  return router;
};

/**
 * Registers a decorator that can be added to a controller's
 * method. The handler will be called at runtime when the
 * endpoint method is invoked with the Context and Next parameters.
 *
 * @param {ClassMethodDecoratorContext} context - standard method decorator context
 * @param {MiddlewareHandler} handler - decorator handler
 */
export function registerMiddlewareMethodDecorator<This extends object, Args extends unknown[], Return>(
  context: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => Return>,
  handler: MiddlewareHandler,
): void {
  if (context.kind !== 'method' || context.static || context.private || typeof context.name !== 'string') {
    throw new Error('registerMiddlewareMethodDecorator() only supports public instance methods.');
  }

  const metadata = context.metadata as DecoratorMetadataBag;
  const registrations = (metadata[MIDDLEWARE_METADATA] as MiddlewareRegistration[] | undefined) ?? [];

  metadata[MIDDLEWARE_METADATA] = [...registrations, {
    functionName: context.name,
    handler,
  }];
}

/**
 * Registers a decorator that can be added to a controller class to apply
 * middleware to every route on it (e.g. a controller-wide `@UseGuard()`).
 * Unlike `registerMiddlewareMethodDecorator()`, this writes directly to the
 * permanent metadata store (like `@Injectable`/`@Module`) instead of via
 * `context.metadata` — a class decorator already has the class reference
 * (`target`) it needs, so there's no ordering dependency on `@Controller()`
 * also running to copy it over.
 *
 * @param {ClassConstructor} target - the decorated controller class
 * @param {MiddlewareHandler} handler - decorator handler
 */
export function registerMiddlewareClassDecorator(target: ClassConstructor, handler: MiddlewareHandler): void {
  const existing = getMetadata<MiddlewareHandler[]>(MIDDLEWARE_METADATA, target.prototype) ?? [];

  defineMetadata(MIDDLEWARE_METADATA, [...existing, handler], target.prototype);
}
