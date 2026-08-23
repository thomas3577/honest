import { assertEquals, assertExists } from '@std/assert';

import { API_OPERATION_METADATA, API_RESPONSE_METADATA, API_TAGS_METADATA } from '../const.ts';
import type { ApiOperationMetadata, ApiResponseMetadata } from '../types.ts';
import { getMetadata } from '../utils/metadata.util.ts';
import { Controller } from './controller.decorator.ts';
import { Get, Post } from './http-methods.decorator.ts';
import { ApiExcludeEndpoint, ApiOperation, ApiResponse, ApiTags } from './openapi.decorator.ts';

@ApiTags('users', 'admin')
@Controller('users')
class TaggedAfterController {
  @Get('list')
  list() {}
}

@Controller('users')
@ApiTags('users')
class TaggedBeforeController {
  @Get('list')
  list() {}
}

Deno.test('ApiTags() is discoverable regardless of decoration order relative to Controller()', () => {
  assertEquals(getMetadata<string[]>(API_TAGS_METADATA, TaggedAfterController.prototype), ['users', 'admin']);
  assertEquals(getMetadata<string[]>(API_TAGS_METADATA, TaggedBeforeController.prototype), ['users']);
});

@Controller('items')
class OperationController {
  @ApiOperation({ summary: 'List items', description: 'Returns all items.' })
  @Get('list')
  list() {}

  @ApiResponse({ status: 200, description: 'OK' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @Get(':id')
  find() {}

  @ApiExcludeEndpoint()
  @Get('internal')
  internal() {}
}

Deno.test('ApiOperation() records summary/description metadata per method', () => {
  const metadata = getMetadata<ApiOperationMetadata[]>(API_OPERATION_METADATA, OperationController.prototype);

  assertExists(metadata);
  assertEquals(metadata.find((entry) => entry.functionName === 'list'), {
    functionName: 'list',
    summary: 'List items',
    description: 'Returns all items.',
  });
});

Deno.test('ApiResponse() is stackable, recording one entry per call', () => {
  const metadata = getMetadata<ApiResponseMetadata[]>(API_RESPONSE_METADATA, OperationController.prototype);

  assertExists(metadata);
  const findResponses = metadata.filter((entry) => entry.functionName === 'find');
  assertEquals(findResponses, [
    { functionName: 'find', status: 404, description: 'Not found' },
    { functionName: 'find', status: 200, description: 'OK' },
  ]);
});

Deno.test('ApiExcludeEndpoint() marks the operation entry as excluded', () => {
  const metadata = getMetadata<ApiOperationMetadata[]>(API_OPERATION_METADATA, OperationController.prototype);

  assertExists(metadata);
  assertEquals(metadata.find((entry) => entry.functionName === 'internal'), { functionName: 'internal', excluded: true });
});

@Controller()
class ApiSiblingBaseController {
  @ApiOperation({ summary: 'base' })
  @Get('base-path')
  action() {}
}

@Controller()
class ApiSiblingChildAController extends ApiSiblingBaseController {
  @ApiOperation({ summary: 'child-a' })
  @Post('child-a-path')
  override action() {}
}

@Controller()
class ApiSiblingChildBController extends ApiSiblingBaseController {
  @ApiOperation({ summary: 'child-b' })
  @Post('child-b-path')
  override action() {}
}

Deno.test('ApiOperation() does not leak metadata between sibling subclasses of a shared base', () => {
  const baseMetadata = getMetadata<ApiOperationMetadata[]>(API_OPERATION_METADATA, ApiSiblingBaseController.prototype);
  const childAMetadata = getMetadata<ApiOperationMetadata[]>(API_OPERATION_METADATA, ApiSiblingChildAController.prototype);
  const childBMetadata = getMetadata<ApiOperationMetadata[]>(API_OPERATION_METADATA, ApiSiblingChildBController.prototype);

  assertEquals(baseMetadata, [{ functionName: 'action', summary: 'base' }]);
  assertEquals(childAMetadata, [
    { functionName: 'action', summary: 'base' },
    { functionName: 'action', summary: 'child-a' },
  ]);
  assertEquals(childBMetadata, [
    { functionName: 'action', summary: 'base' },
    { functionName: 'action', summary: 'child-b' },
  ]);
});
