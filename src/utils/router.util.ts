import { Hono } from 'hono';
import type { Context } from 'hono';

import { MIDDLEWARE_METADATA, MODULE_METADATA } from '../const.ts';
import type { ClassConstructor, ControllerClass, CreateRouterOption } from '../types.ts';
import { createInjector } from './injector.util.ts';
import { getMetadata } from './metadata.util.ts';

type Injector = ReturnType<typeof createInjector>;
type Next = () => Promise<unknown>;
type MiddlewareHandler = (c: Context, next: Next) => Response | void | Promise<Response | void>;
type DecoratorMetadataBag = Record<PropertyKey, unknown>;
type MiddlewareRegistration = { functionName: string; handler: MiddlewareHandler };

export const isUndefined = (obj: unknown): obj is undefined => typeof obj === 'undefined';
export const isString = (fn: unknown): fn is string => typeof fn === 'string';
export const isNil = (obj: unknown): obj is null | undefined => isUndefined(obj) || obj === null;

const mergeRoutePrefix = (prefix?: string, routePrefix?: string): string | undefined => {
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

const createRouter = (moduleOptions: CreateRouterOption, injector: Injector, controllerTargets: Set<ClassConstructor<unknown>>, prefix?: string, router = new Hono()): Hono => {
  const { controllers, routePrefix } = moduleOptions;

  controllers?.forEach((Controller: ClassConstructor<unknown>) => {
    if (controllerTargets.has(Controller)) {
      return;
    }

    controllerTargets.add(Controller);

    const prefixFull = mergeRoutePrefix(prefix, routePrefix);
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

const getRouter = (module: ClassConstructor, injector: Injector, controllerTargets: Set<ClassConstructor<unknown>>, prefix?: string, router?: Hono): Hono => {
  const moduleOption = getModuleOptions(module);
  const newRouter: Hono = createRouter(moduleOption, injector, controllerTargets, prefix, router);
  const prefixFull = mergeRoutePrefix(prefix, moduleOption.routePrefix);

  moduleOption.modules?.forEach((module) => getRouter(module, injector, controllerTargets, prefixFull, newRouter)) || [];

  return newRouter;
};

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

  return getRouter(module, injector, new Set<ClassConstructor<unknown>>());
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
