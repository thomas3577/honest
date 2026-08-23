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

export interface OpenApiServer {
  url: string;
  description?: string;
}

export interface OpenApiParameterObject {
  name: string;
  in: 'query' | 'path' | 'header';
  required?: boolean;
  schema?: JsonSchemaObject;
  content?: Record<string, { schema: JsonSchemaObject }>;
}

export interface OpenApiResponseObject {
  description: string;
  content?: Record<string, { schema: JsonSchemaObject }>;
}

export interface OpenApiOperationObject {
  tags?: string[];
  summary?: string;
  description?: string;
  deprecated?: boolean;
  parameters?: OpenApiParameterObject[];
  requestBody?: { content: Record<string, { schema: JsonSchemaObject }> };
  responses: Record<string, OpenApiResponseObject>;
}

export interface OpenApiDocument {
  openapi: '3.1.0';
  info: OpenApiInfo;
  servers?: OpenApiServer[];
  tags?: { name: string }[];
  paths: Record<string, Record<string, OpenApiOperationObject>>;
}
