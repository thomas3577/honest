import { API_OPERATION_METADATA, API_RESPONSE_METADATA, API_TAGS_METADATA, CONTROLLER_METADATA, METHOD_METADATA } from '../const.ts';
import { RouteParamTypes } from '../enums.ts';
import type { JsonSchemaObject, OpenApiDocument, OpenApiInfo, OpenApiOperationObject, OpenApiParameterObject, OpenApiServer } from '../openapi-types.ts';
import type { StandardSchema } from '../standard-schema.ts';
import type { ActionMetadata, ApiOperationMetadata, ApiResponseMetadata, ClassConstructor, ControllerMetadata, ValidatedResolverData } from '../types.ts';
import { getMetadata } from './metadata.util.ts';
import { walkModuleTree } from './router.util.ts';

export interface BuildOpenApiDocumentOptions {
  info: OpenApiInfo;
  servers?: OpenApiServer[];
  /** Converts a Standard Schema (Zod, Valibot, ArkType, ...) to JSON Schema, e.g. Zod's own `z.toJSONSchema`. Without it, request/response shapes backed by a Standard Schema are omitted from the document (path/query/header parameters, tags, summaries and descriptions are unaffected). */
  schemaToJsonSchema?: (schema: StandardSchema) => JsonSchemaObject;
}

interface CollectedController {
  Controller: ClassConstructor;
  prefix?: string;
}

/** Matches a Hono path param segment, optionally with its `{pattern}` constraint (e.g. `:id{[0-9]+}`) — capture group 1 is the name, group 2 the constraint if present. */
const PATH_PARAM_PATTERN = /:([A-Za-z0-9_]+)(?:\{([^}]*)\})?/g;

const isValidatedResolverData = (data: unknown): data is ValidatedResolverData => {
  return typeof data === 'object' && data !== null && 'kind' in data && 'schema' in data;
};

const isStandardSchema = (value: unknown): value is StandardSchema => {
  return typeof value === 'object' && value !== null && '~standard' in value;
};

const joinPaths = (...segments: (string | undefined)[]): string => {
  const joined = segments
    .filter((segment): segment is string => !!segment && segment.length > 0)
    .map((segment) => segment.replace(/^\/+|\/+$/g, ''))
    .filter((segment) => segment.length > 0)
    .join('/');

  return `/${joined}`;
};

const toOpenApiPath = (path: string): string => path.replace(PATH_PARAM_PATTERN, '{$1}');

const mergeOperationMeta = (entries: ApiOperationMetadata[]): Omit<ApiOperationMetadata, 'functionName'> => {
  return Object.assign({}, ...entries.map(({ functionName: _functionName, ...rest }) => rest));
};

/** Expands an object JSON Schema's `properties` into individual OpenAPI parameters. Schemas without `properties` (e.g. a converter that returned something else) yield no parameters. */
const expandObjectSchemaToParameters = (schema: JsonSchemaObject, location: 'query' | 'header' | 'path', forceRequired: boolean): OpenApiParameterObject[] => {
  const properties = schema.properties as Record<string, JsonSchemaObject> | undefined;

  if (!properties) {
    return [];
  }

  const required = new Set((schema.required as string[] | undefined) ?? []);

  return Object.entries(properties).map(([name, propertySchema]) => ({
    name,
    in: location,
    required: forceRequired || required.has(name),
    schema: propertySchema,
  }));
};

const resolveSchema = (schema: StandardSchema | JsonSchemaObject, schemaToJsonSchema?: (schema: StandardSchema) => JsonSchemaObject): JsonSchemaObject | undefined => {
  if (isStandardSchema(schema)) {
    return schemaToJsonSchema?.(schema);
  }

  return schema;
};

/**
 * Collects the parameters for one operation, deduplicating by `(in, name)`.
 * A later `addParameter()` call for the same `(in, name)` pair replaces the
 * earlier one — used so a `validatedParam()`/`validatedQuery()`/`validatedHeaders()`
 * schema (added after the plain URL-segment/`query()`/`headers()` scan below)
 * wins over the generic `{type: 'string'}` placeholder for the same name,
 * instead of both ending up as two conflicting parameter entries.
 */
class ParameterCollector {
  #byKey = new Map<string, OpenApiParameterObject>();

  add(parameter: OpenApiParameterObject): void {
    this.#byKey.set(`${parameter.in}:${parameter.name}`, parameter);
  }

  addAll(parameters: OpenApiParameterObject[]): void {
    parameters.forEach((parameter) => this.add(parameter));
  }

  toArray(): OpenApiParameterObject[] {
    return [...this.#byKey.values()];
  }
}

/**
 * Builds an OpenAPI 3.1 document from a module tree, purely from the
 * metadata `@Controller`/`@Module`/`@Get`/etc. and the new `@ApiTags`/`@ApiOperation`/`@ApiResponse`
 * decorators already recorded — no controller or provider is instantiated,
 * so this has none of the side effects a real `assignModule()` call might
 * trigger via provider constructors.
 *
 * @param {ClassConstructor} module - the root module to document (the same one passed to `assignModule()`)
 * @param {BuildOpenApiDocumentOptions} options - document info and the optional Standard Schema → JSON Schema converter
 */
export function buildOpenApiDocument(module: ClassConstructor, options: BuildOpenApiDocumentOptions): OpenApiDocument {
  const controllers: CollectedController[] = [];

  walkModuleTree(module, undefined, new Set<ClassConstructor>(), (Controller, prefixFull) => {
    controllers.push({ Controller, prefix: prefixFull });
  });

  const document: OpenApiDocument = {
    openapi: '3.1.0',
    info: options.info,
    paths: {},
  };

  if (options.servers) {
    document.servers = options.servers;
  }

  const tags = new Set<string>();

  for (const { Controller, prefix } of controllers) {
    const controllerMeta = getMetadata<ControllerMetadata>(CONTROLLER_METADATA, Controller.prototype);
    const controllerTags = getMetadata<string[]>(API_TAGS_METADATA, Controller.prototype);
    const actions = getMetadata<ActionMetadata[]>(METHOD_METADATA, Controller.prototype) ?? [];
    const operations = getMetadata<ApiOperationMetadata[]>(API_OPERATION_METADATA, Controller.prototype) ?? [];
    const responses = getMetadata<ApiResponseMetadata[]>(API_RESPONSE_METADATA, Controller.prototype) ?? [];
    const controllerPath = joinPaths(prefix, controllerMeta?.path);

    controllerTags?.forEach((tag) => tags.add(tag));

    for (const action of actions) {
      if (action.method === 'all') {
        continue;
      }

      // Matched by declarationId (the exact method declaration), not functionName:
      // an overridden method keeps its base functionName but is a distinct
      // declaration, so functionName alone would also match the base's own
      // (unrelated) @ApiOperation()/@ApiResponse() entries.
      const operationMeta = mergeOperationMeta(operations.filter((entry) => entry.declarationId === action.declarationId));

      if (operationMeta.excluded) {
        continue;
      }

      const fullPath = joinPaths(controllerPath, action.path);
      const parameters = new ParameterCollector();
      let requestBody: OpenApiOperationObject['requestBody'];

      for (const match of fullPath.matchAll(PATH_PARAM_PATTERN)) {
        const [, name, pattern] = match;

        parameters.add({ name, in: 'path', required: true, schema: pattern ? { type: 'string', pattern } : { type: 'string' } });
      }

      for (const arg of action.args ?? []) {
        if (arg.paramType === RouteParamTypes.QUERY && typeof arg.data === 'string') {
          parameters.add({ name: arg.data, in: 'query', schema: { type: 'string' } });
          continue;
        }

        if (arg.paramType === RouteParamTypes.HEADERS && typeof arg.data === 'string') {
          parameters.add({ name: arg.data, in: 'header', schema: { type: 'string' } });
          continue;
        }

        if (arg.paramType !== RouteParamTypes.CUSTOM || !isValidatedResolverData(arg.data)) {
          continue;
        }

        const jsonSchema = resolveSchema(arg.data.schema, options.schemaToJsonSchema);

        if (!jsonSchema) {
          continue;
        }

        if (arg.data.kind === 'body') {
          requestBody = { content: { 'application/json': { schema: jsonSchema } } };
        } else if (arg.data.kind === 'query') {
          parameters.addAll(expandObjectSchemaToParameters(jsonSchema, 'query', false));
        } else if (arg.data.kind === 'headers') {
          parameters.addAll(expandObjectSchemaToParameters(jsonSchema, 'header', false));
        } else if (arg.data.kind === 'param') {
          parameters.addAll(expandObjectSchemaToParameters(jsonSchema, 'path', true));
        }
      }

      const responseEntries = responses.filter((entry) => entry.declarationId === action.declarationId);
      const operationResponses: OpenApiOperationObject['responses'] = {};

      if (responseEntries.length === 0) {
        operationResponses['200'] = { description: 'Successful response' };
      } else {
        for (const response of responseEntries) {
          const jsonSchema = response.schema ? resolveSchema(response.schema, options.schemaToJsonSchema) : undefined;

          operationResponses[String(response.status)] = {
            description: response.description ?? `HTTP ${response.status}`,
            ...(jsonSchema ? { content: { 'application/json': { schema: jsonSchema } } } : {}),
          };
        }
      }

      const parameterList = parameters.toArray();
      const operation: OpenApiOperationObject = {
        ...(controllerTags && controllerTags.length > 0 ? { tags: controllerTags } : {}),
        ...(operationMeta.summary ? { summary: operationMeta.summary } : {}),
        ...(operationMeta.description ? { description: operationMeta.description } : {}),
        ...(operationMeta.deprecated ? { deprecated: operationMeta.deprecated } : {}),
        ...(parameterList.length > 0 ? { parameters: parameterList } : {}),
        ...(requestBody ? { requestBody } : {}),
        responses: operationResponses,
      };

      const openApiPath = toOpenApiPath(fullPath);

      document.paths[openApiPath] ??= {};
      document.paths[openApiPath][action.method] = operation;
    }
  }

  if (tags.size > 0) {
    document.tags = [...tags].map((name) => ({ name }));
  }

  return document;
}
