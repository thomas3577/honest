const declarationIds = new WeakMap<object, number>();
let nextDeclarationId = 0;

/**
 * Assigns a stable numeric identity to a decorated method's function value.
 * All decorators stacked on one method declaration (e.g. `@Get()` and
 * `@ApiOperation()` on the same method) receive the same function value —
 * none of them replace it — so this lets independently-accumulated metadata
 * (`METHOD_METADATA`, `API_OPERATION_METADATA`, `API_RESPONSE_METADATA`) be
 * correlated back to the exact declaration it came from.
 *
 * This matters because `functionName` alone is ambiguous: a subclass that
 * overrides a method under the same name with a different route mapping
 * produces a distinct function object, but the same `functionName` string.
 */
export function getMethodDeclarationId(method: object): number {
  let id = declarationIds.get(method);

  if (id === undefined) {
    id = ++nextDeclarationId;
    declarationIds.set(method, id);
  }

  return id;
}
