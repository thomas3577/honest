import '../utils/reflect-shim.ts';

import { METHOD_METADATA } from '../const.ts';
import type { ActionMetadata, HTTPMethods, RouteArgResolver } from '../types.ts';

type DecoratorMetadataBag = Record<PropertyKey, unknown>;
type RouteMethodDecorator = <This, Args extends unknown[], Return>(
  value: (this: This, ...args: Args) => Return,
  context: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => Return>,
) => void;

/**
 * HTTP Method GET
 *
 * @param {string} path - Path for the route
 */
export const Get: HttpMethod = mappingMethod('get');

/**
 * HTTP Method POST
 *
 * @param {string} path - Path for the route
 */
export const Post: HttpMethod = mappingMethod('post');

/**
 * HTTP Method PUT
 *
 * @param {string} path - Path for the route
 */
export const Put: HttpMethod = mappingMethod('put');

/**
 * HTTP Method PATCH
 *
 * @param {string} path - Path for the route
 */
export const Patch: HttpMethod = mappingMethod('patch');

/**
 * HTTP Method DELETE
 *
 * @param {string} path - Path for the route
 */
export const Delete: HttpMethod = mappingMethod('delete');

/**
 * HTTP Method OPTIONS
 *
 * @param {string} path - Path for the route
 */
export const All: HttpMethod = mappingMethod('all');

/**
 * HTTP Method
 */
export type HttpMethod = {
  (path?: string, args?: RouteArgResolver[]): RouteMethodDecorator;
  (args: RouteArgResolver[]): RouteMethodDecorator;
};

function mappingMethod(method: HTTPMethods): HttpMethod {
  return (pathOrArgs: string | RouteArgResolver[] = '', args?: RouteArgResolver[]) =>
  <This, Args extends unknown[], Return>(
    _value: (this: This, ...args: Args) => Return,
    context: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => Return>,
  ) => {
    if (context.kind !== 'method' || context.static || context.private) {
      throw new Error(`@${method.toUpperCase()}() can only be used on public instance methods.`);
    }

    if (typeof context.name !== 'string') {
      throw new Error(`@${method.toUpperCase()}() only supports string-named methods.`);
    }

    const path = Array.isArray(pathOrArgs) ? '' : pathOrArgs;
    const routeArgs = Array.isArray(pathOrArgs) ? pathOrArgs : args;
    const meta: ActionMetadata = {
      path,
      method,
      functionName: context.name,
    };

    if (routeArgs) {
      meta.args = routeArgs;
    }

    addMetadata(meta, context.metadata as DecoratorMetadataBag, METHOD_METADATA);
  };
}

function addMetadata<T>(value: T, metadata: DecoratorMetadataBag, key: symbol): void {
  const list = (metadata[key] as T[] | undefined) ?? [];

  metadata[key] = [...list, value];
}
