import '../utils/reflect-shim.ts';

import { API_OPERATION_METADATA, API_RESPONSE_METADATA, API_TAGS_METADATA } from '../const.ts';
import type { JsonSchemaObject } from '../openapi-types.ts';
import type { StandardSchema } from '../standard-schema.ts';
import type { ApiOperationMetadata, ApiResponseMetadata, ClassConstructor } from '../types.ts';
import { defineMetadata } from '../utils/metadata.util.ts';
import { getMethodDeclarationId } from '../utils/method-identity.util.ts';

type DecoratorMetadataBag = Record<PropertyKey, unknown>;
type MethodDecorator = <This, Args extends unknown[], Return>(
  value: (this: This, ...args: Args) => Return,
  context: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => Return>,
) => void;

export interface ApiOperationOptions {
  summary?: string;
  description?: string;
  deprecated?: boolean;
}

export interface ApiResponseOptions {
  status: number;
  description?: string;
  schema?: StandardSchema | JsonSchemaObject;
}

function addMetadata<T>(value: T, metadata: DecoratorMetadataBag, key: symbol): void {
  const list = (metadata[key] as T[] | undefined) ?? [];

  metadata[key] = [...list, value];
}

/**
 * Attaches OpenAPI tags to every route on this controller, read by
 * `buildOpenApiDocument()`. Self-contained, like `@Injectable`/`@Module` —
 * writes directly to the permanent metadata store, so it works regardless
 * of decoration order relative to `@Controller()`.
 */
export function ApiTags<T>(...tags: string[]): (target: ClassConstructor<T>, context: ClassDecoratorContext<ClassConstructor<T>>) => void {
  return (target: ClassConstructor<T>, _context: ClassDecoratorContext<ClassConstructor<T>>) => {
    defineMetadata(API_TAGS_METADATA, tags, target.prototype);
  };
}

/** Documents a route's summary/description for `buildOpenApiDocument()`. Purely descriptive — has no effect on routing or request handling. */
export function ApiOperation(options: ApiOperationOptions): MethodDecorator {
  return (value, context) => {
    if (context.kind !== 'method' || context.static || context.private || typeof context.name !== 'string') {
      throw new Error('@ApiOperation() can only be used on public instance methods.');
    }

    const meta: ApiOperationMetadata = { functionName: context.name, declarationId: getMethodDeclarationId(value), ...options };

    addMetadata(meta, context.metadata as DecoratorMetadataBag, API_OPERATION_METADATA);
  };
}

/** Documents one possible response for a route. Stackable — apply multiple times to describe multiple status codes. */
export function ApiResponse(options: ApiResponseOptions): MethodDecorator {
  return (value, context) => {
    if (context.kind !== 'method' || context.static || context.private || typeof context.name !== 'string') {
      throw new Error('@ApiResponse() can only be used on public instance methods.');
    }

    const meta: ApiResponseMetadata = { functionName: context.name, declarationId: getMethodDeclarationId(value), ...options };

    addMetadata(meta, context.metadata as DecoratorMetadataBag, API_RESPONSE_METADATA);
  };
}

/** Hides a route from the document produced by `buildOpenApiDocument()`. Has no effect on routing. */
export function ApiExcludeEndpoint(): MethodDecorator {
  return (value, context) => {
    if (context.kind !== 'method' || context.static || context.private || typeof context.name !== 'string') {
      throw new Error('@ApiExcludeEndpoint() can only be used on public instance methods.');
    }

    const meta: ApiOperationMetadata = { functionName: context.name, declarationId: getMethodDeclarationId(value), excluded: true };

    addMetadata(meta, context.metadata as DecoratorMetadataBag, API_OPERATION_METADATA);
  };
}
