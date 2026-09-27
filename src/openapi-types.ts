/**
 * A minimal, local subset of the OpenAPI 3.1 document shape — just enough to
 * describe what `buildOpenApiDocument()` produces. Kept local on purpose
 * (like `standard-schema.ts`): no runtime code, no dependency on an OpenAPI
 * types package.
 */

export type JsonSchemaObject = Record<string, unknown>;

export interface OpenApiInfo {
  title: string;
  version: string;
  description?: string;
}

/** An OpenAPI Server Object. */
export interface OpenApiServer {
  /** URL of the target host. */
  url: string;
  /** Description of the host. */
  description?: string;
}

/** An OpenAPI Parameter Object. */
export interface OpenApiParameterObject {
  /** Parameter name. */
  name: string;
  /** Location of the parameter. */
  in: 'query' | 'path' | 'header';
  /** Whether the parameter is mandatory. */
  required?: boolean;
  /** JSON Schema of the parameter. */
  schema?: JsonSchemaObject;
  /** Parameter schema keyed by media type. */
  content?: Record<string, { schema: JsonSchemaObject }>;
}

/** An OpenAPI Response Object. */
export interface OpenApiResponseObject {
  /** Description of the response. */
  description: string;
  /** Response body schema keyed by media type. */
  content?: Record<string, { schema: JsonSchemaObject }>;
}

/** An OpenAPI Operation Object. */
export interface OpenApiOperationObject {
  /** Tags for grouping the operation. */
  tags?: string[];
  /** Short summary of the operation. */
  summary?: string;
  /** Longer description of the operation. */
  description?: string;
  /** Whether the operation is deprecated. */
  deprecated?: boolean;
  /** Path, query and header parameters. */
  parameters?: OpenApiParameterObject[];
  /** Request body schema keyed by media type. */
  requestBody?: { content: Record<string, { schema: JsonSchemaObject }> };
  /** Responses keyed by status code. */
  responses: Record<string, OpenApiResponseObject>;
}

/** An OpenAPI 3.1 document. */
export interface OpenApiDocument {
  /** OpenAPI version. */
  openapi: '3.1.0';
  /** API metadata. */
  info: OpenApiInfo;
  /** Servers hosting the API. */
  servers?: OpenApiServer[];
  /** Tags used by the operations. */
  tags?: { name: string }[];
  /** Operations keyed by path, then by HTTP method. */
  paths: Record<string, Record<string, OpenApiOperationObject>>;
}
