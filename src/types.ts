import type { Context, Hono } from 'hono';

import type { RouteParamTypes } from './enums.ts';

export type HTTPMethods = 'get' | 'put' | 'patch' | 'post' | 'delete' | 'all';

export interface ActionMetadata {
  path: string;
  method: HTTPMethods;
  functionName: string;
  args?: RouteArgResolver[];
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
