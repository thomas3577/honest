import { Hono } from 'hono';
import type { Context } from 'hono';

import { MIDDLEWARE_METADATA, MODULE_METADATA } from '../const.ts';
import type { ClassConstructor, ControllerClass, CreateRouterOption } from '../types.ts';
import { createInjector, type NeedleInjector } from './injector.util.ts';
import { getMetadata } from './metadata.util.ts';

type Next = () => Promise<unknown>;
type MiddlewareHandler = (c: Context, next: Next) => Response | void | Promise<Response | void>;
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
  const injector = createInjector(getProviders(module));
  const router = new Hono();

  // Registered before any controller routes are mounted below, since Hono
  // executes middleware/routes in registration order — a request-scope
  // must exist before any route (or its own middleware) can read it.
  router.use('*', async (c, next) => {
    setRequestScope(c, injector.createScope());
    await next();
  });

  walkModuleTree(module, undefined, new Set<ClassConstructor>(), (Controller, prefixFull) => {
    const controller: ControllerClass = injector.resolve(Controller as ClassConstructor<ControllerClass>);
    controller.init(prefixFull);

    const { path, route } = controller;

    if (!route) {
      throw new Error(`Controller ${Controller.name} has no route defined.`);
    }

    router.route(path && path.length > 0 ? path : '/', route);
  });

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
