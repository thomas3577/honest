import '../utils/reflect-shim.ts';

import { METHOD_METADATA } from '../const.ts';
import type { ActionMetadata, HTTPMethods, MethodDecoratorFn, RouteArgResolver } from '../types.ts';
import { getMethodDeclarationId } from '../utils/method-identity.util.ts';

type DecoratorMetadataBag = Record<PropertyKey, unknown>;

/**
 * Matches Oak's wildcard param modifiers (`:name*` zero-or-more, `:name+`
 * one-or-more). Hono has no such modifier — it treats a trailing `*`/`+` as
 * part of the literal param name instead of rejecting it, so a route
 * migrated as-is from oakest silently changes meaning (e.g. `/` stops
 * matching) instead of failing loudly. Deliberately excludes `:name{...}`
 * (Hono's actual wildcard syntax, e.g. `:name{.*}`) by requiring the `*`/`+`
 * to follow the identifier directly.
 */
const OAK_WILDCARD_PATTERN = /:[A-Za-z_$][\w$]*([*+])/;

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
  (path?: string, args?: RouteArgResolver[]): MethodDecoratorFn;
  (args: RouteArgResolver[]): MethodDecoratorFn;
};

function mappingMethod(method: HTTPMethods): HttpMethod {
  return (pathOrArgs: string | RouteArgResolver[] = '', args?: RouteArgResolver[]) =>
  <This, Args extends unknown[], Return>(
    value: (this: This, ...args: Args) => Return,
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
    const wildcardMatch = path.match(OAK_WILDCARD_PATTERN);

    if (wildcardMatch) {
      const modifier = wildcardMatch[1] === '*' ? '{.*}' : '{.+}';
      throw new Error(
        `Route path "${path}" uses Oak's wildcard param syntax ("${wildcardMatch[0]}"), which Hono treats as a literal parameter name instead of a wildcard. Use Hono's syntax instead: "${wildcardMatch[0].slice(0, -1)}${modifier}".`,
      );
    }
    const meta: ActionMetadata = {
      path,
      method,
      functionName: context.name,
      declarationId: getMethodDeclarationId(value),
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
