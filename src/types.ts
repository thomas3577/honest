import type { Context, Hono } from 'hono';

import type { RouteParamTypes } from './enums.ts';
import type { JsonSchemaObject } from './openapi-types.ts';
import type { StandardSchema } from './standard-schema.ts';

export type HTTPMethods = 'get' | 'put' | 'patch' | 'post' | 'delete' | 'all';

export interface ActionMetadata {
  path: string;
  method: HTTPMethods;
  functionName: string;
  args?: RouteArgResolver[];
  /** Identifies the exact method declaration this came from — see `getMethodDeclarationId()`. Distinguishes overrides that share a `functionName` but map to a different route. */
  declarationId?: number;
}

export interface CreateRouterOption {
  controllers?: ClassConstructor[];
  providers?: ClassConstructor[];
  modules?: ClassConstructor[];
  routePrefix?: string;
}

export type ParamData = Record<string, unknown> | string | number;

/**
 * Controller base type
 */
export type ControllerClass = {
  path?: string;
  route?: Hono;
  init(routePrefix?: string): void;
};

export interface RouteArgResolver {
  paramType: RouteParamTypes;
  data?: ParamData;
  handler?: (c: Context, data?: ParamData) => unknown;
}

export interface TypedRouteArgResolver<T = unknown> extends RouteArgResolver {
  readonly __type?: T;
}

// deno-lint-ignore no-explicit-any -- Constructor parameter types must stay permissive for assignability across decorated classes.
export type ClassConstructor<T = object> = new (...args: any[]) => T;

/** A controller's own path segment (the argument to `@Controller(path)`), mirrored into metadata so it can be read without instantiating the controller. */
export interface ControllerMetadata {
  path?: string;
}

export interface ApiOperationMetadata {
  functionName: string;
  summary?: string;
  description?: string;
  deprecated?: boolean;
  excluded?: boolean;
  /** Identifies the exact method declaration this came from — see `getMethodDeclarationId()`. Distinguishes overrides that share a `functionName` but map to a different route. */
  declarationId?: number;
}

export interface ApiResponseMetadata {
  functionName: string;
  status: number;
  description?: string;
  schema?: StandardSchema | JsonSchemaObject;
  /** Identifies the exact method declaration this came from — see `getMethodDeclarationId()`. Distinguishes overrides that share a `functionName` but map to a different route. */
  declarationId?: number;
}

export type ValidatedResolverKind = 'body' | 'query' | 'param' | 'headers';

/**
 * The `data` payload attached by `validatedBody`/`validatedQuery`/`validatedParam`/`validatedHeaders`
 * to their `custom()` resolver — otherwise the schema would only live inside
 * the resolver's closure. Read by `buildOpenApiDocument()` to introspect the
 * request shape; the resolver's own handler ignores this payload since it
 * already has `schema` in scope.
 */
export interface ValidatedResolverData<TSchema extends StandardSchema = StandardSchema> {
  kind: ValidatedResolverKind;
  schema: TSchema;
}
