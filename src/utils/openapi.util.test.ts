import { assertEquals } from '@std/assert';

import { ApiExcludeEndpoint, ApiOperation, ApiResponse, ApiTags } from '../decorators/openapi.decorator.ts';
import { Controller } from '../decorators/controller.decorator.ts';
import { All, Get, Post } from '../decorators/http-methods.decorator.ts';
import { Module } from '../decorators/module.decorator.ts';
import { headers, param, query, validatedBody, validatedParam, validatedQuery } from '../decorators/route-params.decorator.ts';
import type { JsonSchemaObject } from '../openapi-types.ts';
import type { StandardSchema } from '../standard-schema.ts';
import { buildOpenApiDocument } from './openapi.util.ts';

function fakeSchema<T>(): StandardSchema<unknown, T> {
  return { '~standard': { version: 1, vendor: 'test', validate: (value) => ({ value: value as T }) } };
}

@ApiTags('widgets')
@Controller('widgets')
class WidgetController {
  @ApiOperation({ summary: 'Get a widget', deprecated: true })
  @ApiResponse({ status: 200, description: 'The widget' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @Get(':id', [param<string>('id')])
  get(_id: string) {}

  @Get('list', [query<string | null>('search')])
  list(_search: string | null) {}

  @Get('undocumented')
  undocumented() {}

  @ApiExcludeEndpoint()
  @Get('internal')
  internal() {}

  @All('anything')
  anything() {}
}

@Module({ controllers: [WidgetController], routePrefix: 'api' })
class WidgetModule {}

Deno.test('buildOpenApiDocument() includes info and merges module routePrefix into paths', () => {
  const document = buildOpenApiDocument(WidgetModule, { info: { title: 'Test API', version: '1.0.0' } });

  assertEquals(document.openapi, '3.1.0');
  assertEquals(document.info, { title: 'Test API', version: '1.0.0' });
  assertEquals(Object.keys(document.paths).sort(), ['/api/widgets/list', '/api/widgets/undocumented', '/api/widgets/{id}']);
});

Deno.test('buildOpenApiDocument() maps tags, summary, deprecated, and stacked responses', () => {
  const document = buildOpenApiDocument(WidgetModule, { info: { title: 'Test API', version: '1.0.0' } });
  const operation = document.paths['/api/widgets/{id}'].get;

  assertEquals(operation.tags, ['widgets']);
  assertEquals(operation.summary, 'Get a widget');
  assertEquals(operation.deprecated, true);
  assertEquals(operation.responses, {
    '200': { description: 'The widget' },
    '404': { description: 'Not found' },
  });
  assertEquals(operation.parameters, [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }]);
});

Deno.test('buildOpenApiDocument() synthesizes a default 200 response when no @ApiResponse() is used', () => {
  const document = buildOpenApiDocument(WidgetModule, { info: { title: 'Test API', version: '1.0.0' } });
  const operation = document.paths['/api/widgets/undocumented'].get;

  assertEquals(operation.responses, { '200': { description: 'Successful response' } });
});

Deno.test('buildOpenApiDocument() maps a plain query() resolver to a simple parameter', () => {
  const document = buildOpenApiDocument(WidgetModule, { info: { title: 'Test API', version: '1.0.0' } });
  const operation = document.paths['/api/widgets/list'].get;

  assertEquals(operation.parameters, [{ name: 'search', in: 'query', schema: { type: 'string' } }]);
});

Deno.test('buildOpenApiDocument() excludes routes marked with @ApiExcludeEndpoint()', () => {
  const document = buildOpenApiDocument(WidgetModule, { info: { title: 'Test API', version: '1.0.0' } });

  assertEquals('/api/widgets/internal' in document.paths, false);
});

Deno.test('buildOpenApiDocument() skips @All() routes, which have no OpenAPI method equivalent', () => {
  const document = buildOpenApiDocument(WidgetModule, { info: { title: 'Test API', version: '1.0.0' } });

  assertEquals('/api/widgets/anything' in document.paths, false);
});

interface CreateWidgetBody {
  name: string;
}

@Controller('widgets')
class ValidatedController {
  @Post(':id', [validatedBody(fakeSchema<CreateWidgetBody>())])
  create(_body: CreateWidgetBody) {}

  @Get('search', [validatedQuery(fakeSchema<{ term: string }>())])
  search(_query: { term: string }) {}
}

@Module({ controllers: [ValidatedController] })
class ValidatedModule {}

Deno.test('buildOpenApiDocument() omits schema-backed request bodies/parameters without a schemaToJsonSchema converter', () => {
  const document = buildOpenApiDocument(ValidatedModule, { info: { title: 'Test API', version: '1.0.0' } });
  const createOperation = document.paths['/widgets/{id}'].post;
  const searchOperation = document.paths['/widgets/search'].get;

  assertEquals(createOperation.requestBody, undefined);
  assertEquals(searchOperation.parameters, undefined);
});

Deno.test('buildOpenApiDocument() converts validatedBody() into requestBody via schemaToJsonSchema', () => {
  const bodySchema: JsonSchemaObject = { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] };
  const document = buildOpenApiDocument(ValidatedModule, {
    info: { title: 'Test API', version: '1.0.0' },
    schemaToJsonSchema: () => bodySchema,
  });

  assertEquals(document.paths['/widgets/{id}'].post.requestBody, {
    content: { 'application/json': { schema: bodySchema } },
  });
});

Deno.test('buildOpenApiDocument() expands validatedQuery() object schema properties into individual query parameters', () => {
  const querySchema: JsonSchemaObject = { type: 'object', properties: { term: { type: 'string' } }, required: ['term'] };
  const document = buildOpenApiDocument(ValidatedModule, {
    info: { title: 'Test API', version: '1.0.0' },
    schemaToJsonSchema: () => querySchema,
  });

  assertEquals(document.paths['/widgets/search'].get.parameters, [
    { name: 'term', in: 'query', required: true, schema: { type: 'string' } },
  ]);
});

@Controller('headers-widgets')
class HeaderController {
  @Get('', [headers<string | undefined>('x-token')])
  get(_token: string | undefined) {}
}

@Module({ controllers: [HeaderController] })
class HeaderModule {}

Deno.test('buildOpenApiDocument() maps a plain headers() resolver to a header parameter', () => {
  const document = buildOpenApiDocument(HeaderModule, { info: { title: 'Test API', version: '1.0.0' } });

  assertEquals(document.paths['/headers-widgets'].get.parameters, [{ name: 'x-token', in: 'header', schema: { type: 'string' } }]);
});

@Controller('items')
class DedupParamController {
  @Get(':id', [validatedParam(fakeSchema<{ id: number }>())])
  get(_params: { id: number }) {}
}

@Module({ controllers: [DedupParamController] })
class DedupParamModule {}

Deno.test('buildOpenApiDocument() does not duplicate a path parameter declared both by the URL segment and validatedParam()', () => {
  const idSchema: JsonSchemaObject = { type: 'object', properties: { id: { type: 'number' } }, required: ['id'] };
  const document = buildOpenApiDocument(DedupParamModule, {
    info: { title: 'Test API', version: '1.0.0' },
    schemaToJsonSchema: () => idSchema,
  });

  assertEquals(document.paths['/items/{id}'].get.parameters, [{ name: 'id', in: 'path', required: true, schema: { type: 'number' } }]);
});

@Controller()
class OverrideBaseController {
  @ApiOperation({ summary: 'base summary' })
  @Get('base-path')
  action() {}
}

@Controller()
class OverrideChildController extends OverrideBaseController {
  @ApiOperation({ summary: 'child summary' })
  @Post('child-path')
  override action() {}
}

@Module({ controllers: [OverrideChildController] })
class OverrideModule {}

Deno.test('buildOpenApiDocument() attributes @ApiOperation() to the exact route it was declared on, even when an override maps to a different route under the same functionName', () => {
  const document = buildOpenApiDocument(OverrideModule, { info: { title: 'Test API', version: '1.0.0' } });

  assertEquals(document.paths['/base-path'].get.summary, 'base summary');
  assertEquals(document.paths['/child-path'].post.summary, 'child summary');
});

@Controller('items')
class ConstrainedParamController {
  @Get(':id{[0-9]+}')
  get() {}
}

@Module({ controllers: [ConstrainedParamController] })
class ConstrainedParamModule {}

Deno.test('buildOpenApiDocument() handles a Hono path-param constraint like :id{[0-9]+}', () => {
  const document = buildOpenApiDocument(ConstrainedParamModule, { info: { title: 'Test API', version: '1.0.0' } });

  assertEquals(Object.keys(document.paths), ['/items/{id}']);
  assertEquals(document.paths['/items/{id}'].get.parameters, [{ name: 'id', in: 'path', required: true, schema: { type: 'string', pattern: '[0-9]+' } }]);
});
