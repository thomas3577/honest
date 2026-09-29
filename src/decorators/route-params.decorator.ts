import type { Context } from 'hono';

import { RouteParamTypes } from '../enums.ts';
import { ValidationError } from '../errors.ts';
import type { InferOutput, StandardSchema } from '../standard-schema.ts';
import { isNil, isString, requireRequestScope } from '../utils/router.util.ts';
import type { ClassConstructor, Next, ParamData, TypedRouteArgResolver, ValidatedResolverData } from '../types.ts';

// Type mapping from RouteParamTypes to their concrete return types
export type RouteParamReturn<TParam extends RouteParamTypes> = TParam extends RouteParamTypes.REQUEST ? Context['req']
  : TParam extends RouteParamTypes.CONTEXT ? Context
  : TParam extends RouteParamTypes.RESPONSE ? Context
  : TParam extends RouteParamTypes.NEXT ? Next
  : TParam extends RouteParamTypes.BODY ? unknown
  : TParam extends RouteParamTypes.QUERY ? string | undefined | URLSearchParams
  : TParam extends RouteParamTypes.PARAM ? string | undefined | Record<string, string>
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

/** Injects Hono's request object (`c.req`). */
export const req: RouteArgResolverFactory<Context['req']> = createRouteArgResolver(RouteParamTypes.REQUEST);
/** Injects the Hono `Context`. */
export const ctx: RouteArgResolverFactory<Context> = createRouteArgResolver(RouteParamTypes.CONTEXT);

/**
 * Alias for `ctx()`. Unlike Oak's `res()`, which returned a distinct mutable
 * response object, Hono has no separate response object — everything is
 * expressed through what the handler returns. `res()` resolves to the same
 * `Context` as `ctx()`; prefer `ctx()` directly in new code.
 */
export const res: RouteArgResolverFactory<Context> = createRouteArgResolver(RouteParamTypes.RESPONSE);
/** Injects Hono's `next()` function. */
export const next: RouteArgResolverFactory<Next> = createRouteArgResolver(RouteParamTypes.NEXT);
/** Injects a single query parameter by key (`undefined` if absent), or all query parameters as `URLSearchParams`. */
export const query: RouteArgResolverFactory<string | undefined | URLSearchParams> = createRouteArgResolver(RouteParamTypes.QUERY);
/** Injects a single path parameter by key (`undefined` if absent), or all path parameters as a record. */
export const param: RouteArgResolverFactory<string | undefined | Record<string, string>> = createRouteArgResolver(RouteParamTypes.PARAM);
/** Injects the parsed request body. */
export const body: RouteArgResolverFactory<unknown> = createRouteArgResolver(RouteParamTypes.BODY);
/** Injects a single request header by key, or all headers as a record. */
export const headers: RouteArgResolverFactory<string | undefined | Record<string, string>> = createRouteArgResolver(RouteParamTypes.HEADERS);

/** Options for `ip()`. */
export type IpResolverOptions = {
  /**
   * Trust the `X-Forwarded-For` header (first entry) over the raw socket
   * address. Off by default: a client can set this header itself, so only
   * enable it when a proxy you control strips/overwrites it at the edge.
   */
  trustProxy?: boolean;
};

/**
 * Resolves the client IP. By default uses Hono's Deno adapter
 * (`getConnInfo`), same as calling `ip()` with no options. Pass
 * `{ trustProxy: true }` to prefer `X-Forwarded-For` when running behind a
 * reverse proxy/load balancer — only do this if that proxy is trusted to
 * set the header itself, since it's otherwise client-spoofable.
 */
export function ip(options?: IpResolverOptions): TypedRouteArgResolver<string> {
  return {
    paramType: RouteParamTypes.IP,
    data: options,
  };
}

/** Injects the value returned by a custom `handler(c, data)`, awaited. */
export const custom: CustomRouteArgResolverFactory = <THandler extends (c: Context, data?: ParamData) => unknown>(handler: THandler, data?: ParamData): TypedRouteArgResolver<Awaited<ReturnType<THandler>>> => {
  return {
    paramType: RouteParamTypes.CUSTOM,
    data,
    handler,
  };
};

/**
 * Resolves a request-scoped instance of `target`, backed by a fresh
 * needle-di child container created once per request by `assignModule()`.
 * `target`'s own constructor can still `inject(...)` this module's regular
 * singleton providers — only `target` itself (and anything it doesn't
 * already inject from the parent) is fresh per request.
 *
 * Requires the controller to be mounted via `assignModule()`.
 */
export function scoped<T extends object>(target: ClassConstructor<T>): TypedRouteArgResolver<T> {
  return custom((c) => requireRequestScope(c, 'scoped()').resolve(target));
}

async function validate<TSchema extends StandardSchema>(schema: TSchema, value: unknown): Promise<InferOutput<TSchema>> {
  const result = await schema['~standard'].validate(value);

  if (result.issues) {
    throw new ValidationError(result.issues);
  }

  return result.value as InferOutput<TSchema>;
}

/** Validates the parsed JSON body against a Standard Schema-compatible schema (Zod, Valibot, ArkType, ...). Throws `ValidationError` on failure (including malformed JSON). */
export function validatedBody<TSchema extends StandardSchema>(schema: TSchema): TypedRouteArgResolver<InferOutput<TSchema>> {
  return custom(async (c) => {
    let json: unknown;

    try {
      json = await c.req.json();
    } catch (error) {
      // V8 quotes the (possibly truncated) body: `Unexpected token 'x', "{"password": x}" is not valid JSON` — strip that part.
      const reason = (error instanceof Error ? error.message : String(error)).replace(/, (\.\.\.)?".*" is not valid JSON$/s, '');

      throw new ValidationError([{ message: `Invalid JSON body: ${reason}` }]);
    }

    return validate(schema, json);
  }, { kind: 'body', schema } satisfies ValidatedResolverData<TSchema>);
}

/**
 * Converts a query string to a plain object for schema validation: a key
 * with a single value resolves to that string, a repeated key
 * (`?ids=1&ids=2`) resolves to a string array — no query value is dropped,
 * unlike a plain `Object.fromEntries(searchParams)`.
 */
function queryToRecord(searchParams: URLSearchParams): Record<string, string | string[]> {
  const record: Record<string, string | string[]> = {};

  for (const key of new Set(searchParams.keys())) {
    const values = searchParams.getAll(key);

    record[key] = values.length > 1 ? values : values[0]!;
  }

  return record;
}

/** Validates the query string against a Standard Schema-compatible schema. Repeated keys become string arrays (see `queryToRecord()`). Throws `ValidationError` on failure. */
export function validatedQuery<TSchema extends StandardSchema>(schema: TSchema): TypedRouteArgResolver<InferOutput<TSchema>> {
  return custom((c) => validate(schema, queryToRecord(new URL(c.req.raw.url).searchParams)), { kind: 'query', schema } satisfies ValidatedResolverData<TSchema>);
}

/** Validates the route params against a Standard Schema-compatible schema. Throws `ValidationError` on failure. */
export function validatedParam<TSchema extends StandardSchema>(schema: TSchema): TypedRouteArgResolver<InferOutput<TSchema>> {
  return custom((c) => validate(schema, c.req.param()), { kind: 'param', schema } satisfies ValidatedResolverData<TSchema>);
}

/** Validates the request headers against a Standard Schema-compatible schema. Throws `ValidationError` on failure. */
export function validatedHeaders<TSchema extends StandardSchema>(schema: TSchema): TypedRouteArgResolver<InferOutput<TSchema>> {
  return custom((c) => validate(schema, c.req.header()), { kind: 'headers', schema } satisfies ValidatedResolverData<TSchema>);
}
