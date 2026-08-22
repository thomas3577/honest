import type { Context } from 'hono';

import { RouteParamTypes } from '../enums.ts';
import { isNil, isString } from '../utils/router.util.ts';
import type { ParamData, TypedRouteArgResolver } from '../types.ts';

type Next = () => Promise<unknown>;

// Type mapping from RouteParamTypes to their concrete return types
export type RouteParamReturn<TParam extends RouteParamTypes> = TParam extends RouteParamTypes.REQUEST ? Context['req']
  : TParam extends RouteParamTypes.CONTEXT ? Context
  : TParam extends RouteParamTypes.RESPONSE ? Context
  : TParam extends RouteParamTypes.NEXT ? Next
  : TParam extends RouteParamTypes.BODY ? unknown
  : TParam extends RouteParamTypes.QUERY ? string | URLSearchParams
  : TParam extends RouteParamTypes.PARAM ? string | Record<string, string>
  : TParam extends RouteParamTypes.HEADERS ? string | undefined | Record<string, string>
  : TParam extends RouteParamTypes.IP ? string
  : unknown;

export type RouteArgResolverFactory<TDefault = unknown> = <T = TDefault>(data?: ParamData) => TypedRouteArgResolver<T>;

export type CustomRouteArgResolverFactory = <THandler extends (c: Context, data?: ParamData) => unknown>(handler: THandler, data?: ParamData) => TypedRouteArgResolver<Awaited<ReturnType<THandler>>>;

/**
 * Normalizes the `data` argument of the lookup-key resolvers (`query`,
 * `param`, `body`, `headers`, ...) to a string key or nothing. These
 * resolvers use `data` as an object/map key, so anything else is a caller
 * mistake — it throws immediately (at decoration time) instead of silently
 * discarding the value, which would otherwise surface later as a confusing
 * "resolved the whole object instead of one field" bug.
 *
 * `custom()` does not use this — its `data` is a free-form payload, not a
 * lookup key, and is passed through unchanged.
 */
const normalizeParamData = (data?: ParamData): string | undefined => {
  if (isNil(data)) return undefined;
  if (isString(data)) return data;

  throw new TypeError(`Expected a string key or no data at all, but received ${typeof data}.`);
};

function createRouteArgResolver<TParam extends RouteParamTypes>(paramType: TParam): RouteArgResolverFactory<RouteParamReturn<TParam>> {
  return <T = RouteParamReturn<TParam>>(data?: ParamData): TypedRouteArgResolver<T> => {
    return {
      paramType,
      data: normalizeParamData(data),
    } as TypedRouteArgResolver<T>;
  };
}

export const req: RouteArgResolverFactory<Context['req']> = createRouteArgResolver(RouteParamTypes.REQUEST);
export const ctx: RouteArgResolverFactory<Context> = createRouteArgResolver(RouteParamTypes.CONTEXT);

/**
 * Alias for `ctx()`. Unlike Oak's `res()`, which returned a distinct mutable
 * response object, Hono has no separate response object — everything is
 * expressed through what the handler returns. `res()` resolves to the same
 * `Context` as `ctx()`; prefer `ctx()` directly in new code.
 */
export const res: RouteArgResolverFactory<Context> = createRouteArgResolver(RouteParamTypes.RESPONSE);
export const next: RouteArgResolverFactory<Next> = createRouteArgResolver(RouteParamTypes.NEXT);
export const query: RouteArgResolverFactory<string | URLSearchParams> = createRouteArgResolver(RouteParamTypes.QUERY);
export const param: RouteArgResolverFactory<string | Record<string, string>> = createRouteArgResolver(RouteParamTypes.PARAM);
export const body: RouteArgResolverFactory<unknown> = createRouteArgResolver(RouteParamTypes.BODY);
export const headers: RouteArgResolverFactory<string | undefined | Record<string, string>> = createRouteArgResolver(RouteParamTypes.HEADERS);
export const ip: RouteArgResolverFactory<string> = createRouteArgResolver(RouteParamTypes.IP);

export const custom: CustomRouteArgResolverFactory = <THandler extends (c: Context, data?: ParamData) => unknown>(handler: THandler, data?: ParamData): TypedRouteArgResolver<Awaited<ReturnType<THandler>>> => {
  return {
    paramType: RouteParamTypes.CUSTOM,
    data,
    handler,
  };
};
