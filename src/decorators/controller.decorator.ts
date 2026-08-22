import '../utils/reflect-shim.ts';

import { Hono } from 'hono';
import type { Context } from 'hono';
import * as log from '@std/log';

import { RouteParamTypes } from '../enums.ts';
import { METHOD_METADATA, MIDDLEWARE_METADATA } from '../const.ts';
import type { ActionMetadata, ControllerClass, HTTPMethods, RouteArgResolver } from '../types.ts';
import { defineMetadata, getMetadata, getOwnMetadata } from '../utils/metadata.util.ts';

type Next = () => Promise<unknown>;
type ControllerConstructor = new (...instance: never[]) => object;
type RouteMethodRegistrar = (path: string, ...handlers: unknown[]) => Hono;
type ControllerMethodMap = Record<string, (...args: unknown[]) => unknown>;
type MiddlewareHandler = (c: Context, next: Next) => Response | void | Promise<Response | void>;
type DecoratorMetadataBag = Record<PropertyKey, unknown>;
type MiddlewareRegistration = { functionName: string; handler: MiddlewareHandler };

/**
 * Controller decorator
 *
 * @param {string} options - Path for the controller
 */
export function Controller<T extends ControllerConstructor>(options?: string): (fn: T, context: ClassDecoratorContext<T>) => T {
  const path: string | undefined = options;

  const result = (fn: T, context: ClassDecoratorContext<T>) => {
    const metadata = context.metadata as DecoratorMetadataBag;
    const actions = [...((metadata[METHOD_METADATA] as ActionMetadata[] | undefined) ?? [])];
    const middlewareRegistrations = (metadata[MIDDLEWARE_METADATA] as MiddlewareRegistration[] | undefined) ?? [];

    if (actions.length > 0) {
      defineMetadata(METHOD_METADATA, actions, fn.prototype);
    }

    for (const registration of middlewareRegistrations) {
      const currentHandlers = getOwnMetadata<MiddlewareHandler[]>(MIDDLEWARE_METADATA, fn.prototype, registration.functionName) ?? [];
      const handlers = [...currentHandlers, registration.handler];
      defineMetadata(MIDDLEWARE_METADATA, handlers, fn.prototype, registration.functionName);
    }

    const BaseController = fn as ControllerConstructor;

    return class extends BaseController implements ControllerClass {
      #path?: string;
      #route?: Hono;

      init(routePrefix?: string): void {
        const prefix = routePrefix ? `/${routePrefix}` : '';

        this.#path = prefix + (path ? `/${path}` : '');

        const route = new Hono();
        const methodMap: Record<HTTPMethods, RouteMethodRegistrar> = {
          get: route.get.bind(route),
          post: route.post.bind(route),
          put: route.put.bind(route),
          patch: route.patch.bind(route),
          delete: route.delete.bind(route),
          all: route.all.bind(route),
        };
        const list: ActionMetadata[] = getMetadata(METHOD_METADATA, fn.prototype) || [];

        list.forEach((meta: ActionMetadata) => {
          const middlewaresMetadata = getMetadata(MIDDLEWARE_METADATA, fn.prototype, meta.functionName);
          const middlewares = Array.isArray(middlewaresMetadata) ? middlewaresMetadata : middlewaresMetadata ? [middlewaresMetadata] : [];

          methodMap[meta.method](`/${meta.path}`, ...middlewares, async (c: Context, next: Next) => {
            const handler = (this as unknown as ControllerMethodMap)[meta.functionName];
            const inputs = await resolveHandlerInputs(handler, meta.args, c, next);

            const result = await handler.apply(this, inputs);

            return sendResult(c, result);
          });

          logMapping(meta, this.path);
        });

        this.#route = route;
      }

      get path(): string | undefined {
        return this.#path;
      }

      get route(): Hono | undefined {
        return this.#route;
      }
    } as unknown as T;
  };

  return result;
}

function logMapping(meta: ActionMetadata, path?: string): void {
  const fullPath = path + (meta.path ? `/${meta.path}` : '');
  const methodName = `${meta.method.toUpperCase()}`.padStart(6);

  log.info(`${methodName} ${fullPath}`);
}

/**
 * Maps a handler's return value onto a Hono `Response`.
 *
 * `undefined` means "nothing to send" and becomes a 404, while `null` is a
 * deliberate JSON value (`c.json(null)`, status 200) — only `undefined` is
 * treated as "no result", since `null` is valid, serializable JSON.
 *
 * Exported for direct unit testing; not part of the public API.
 */
export async function sendResult(c: Context, result: unknown): Promise<Response> {
  if (result === undefined) return await c.notFound();
  if (result instanceof Response) return result;
  if (typeof result === 'string') return c.text(result);
  if (result instanceof Uint8Array) return c.body(result as Uint8Array<ArrayBuffer>);
  if (result instanceof ArrayBuffer) return c.body(result);

  return c.json(result as object);
}

async function resolveHandlerInputs(
  handler: (...args: unknown[]) => unknown,
  routeArgs: RouteArgResolver[] | undefined,
  c: Context,
  next: Next,
): Promise<unknown[]> {
  if (routeArgs && routeArgs.length > 0) {
    let cachedBody: unknown | undefined = undefined;
    let bodyParsed = false;

    const inputs = await Promise.all(routeArgs.map(async (data) => {
      if (data.paramType === RouteParamTypes.BODY) {
        if (!bodyParsed) {
          cachedBody = await c.req.json();
          bodyParsed = true;
        }
        return data.data ? (cachedBody as Record<string, unknown>)[data.data.toString()] : cachedBody;
      }
      return await getContextData(data, c, next);
    }));
    const parameterCount = handler.length;

    if (parameterCount === inputs.length) {
      return inputs;
    }

    if (parameterCount === inputs.length + 1) {
      return [...inputs, c];
    }

    throw new Error(`Handler ${handler.name || '<anonymous>'} expects ${parameterCount} parameters, but route mapping resolved ${inputs.length} argument(s). Only an optional trailing ctx parameter is supported.`);
  }

  if (handler.length === 1) {
    return [c];
  }

  if (handler.length > 1) {
    throw new Error(`Handler ${handler.name || '<anonymous>'} expects ${handler.length} parameters, but no route argument mapping was provided. Use @Get/@Post/... with resolver arguments or accept only ctx as a single parameter.`);
  }

  return [];
}

async function getContextData(args: RouteArgResolver, c: Context, next: Next): Promise<unknown> {
  const { paramType, data } = args;

  switch (paramType) {
    case RouteParamTypes.CONTEXT: {
      return c;
    }
    case RouteParamTypes.REQUEST: {
      return c.req;
    }
    case RouteParamTypes.RESPONSE: {
      return c;
    }
    case RouteParamTypes.NEXT: {
      return next;
    }
    case RouteParamTypes.QUERY: {
      const query: URLSearchParams = new URL(c.req.raw.url).searchParams;

      return data ? query.get(data.toString()) : query;
    }
    case RouteParamTypes.PARAM: {
      const params = c.req.param();

      return data ? params[data.toString()] : params;
    }
    case RouteParamTypes.HEADERS: {
      return data ? c.req.header(data.toString()) : c.req.header();
    }
    case RouteParamTypes.IP: {
      const options = data as { trustProxy?: boolean } | undefined;

      if (options?.trustProxy) {
        const forwarded = c.req.header('x-forwarded-for')?.split(',')[0]?.trim();

        if (forwarded) {
          return forwarded;
        }
      }

      try {
        const { getConnInfo } = await import('hono/deno');

        return getConnInfo(c).remote.address ?? '';
      } catch (error) {
        log.debug(`ip() resolver could not determine a connection address: ${error}`);

        return '';
      }
    }
    case RouteParamTypes.CUSTOM: {
      return await args.handler!(c, data);
    }
    default: {
      return;
    }
  }
}
