import { assertEquals, assertExists } from '@std/assert';

import { API_OPERATION_METADATA, API_RESPONSE_METADATA, API_TAGS_METADATA } from '../const.ts';
import type { ApiOperationMetadata, ApiResponseMetadata } from '../types.ts';
import { getMetadata } from '../utils/metadata.util.ts';
import { Controller } from './controller.decorator.ts';
import { Get, Post } from './http-methods.decorator.ts';
import { ApiExcludeEndpoint, ApiOperation, ApiResponse, ApiTags } from './openapi.decorator.ts';

/** `declarationId` is an opaque, run-order-dependent identity (see `getMethodDeclarationId()`) — strip it before comparing the rest of the metadata shape. */
function stripDeclarationId<T extends { declarationId?: number }>(list: T[]): Omit<T, 'declarationId'>[] {
  return list.map(({ declarationId: _declarationId, ...rest }) => rest);
}

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
  assertEquals(stripDeclarationId(metadata).find((entry) => entry.functionName === 'list'), {
    functionName: 'list',
    summary: 'List items',
    description: 'Returns all items.',
  });
});

Deno.test('ApiResponse() is stackable, recording one entry per call', () => {
  const metadata = getMetadata<ApiResponseMetadata[]>(API_RESPONSE_METADATA, OperationController.prototype);

  assertExists(metadata);
  const findResponses = metadata.filter((entry) => entry.functionName === 'find');
  assertEquals(stripDeclarationId(findResponses), [
    { functionName: 'find', status: 404, description: 'Not found' },
    { functionName: 'find', status: 200, description: 'OK' },
  ]);
  // Both responses were declared on the same @Get(':id') method, so they
  // share the same declarationId — this is what lets buildOpenApiDocument()
  // attribute both to that one route.
  assertEquals(findResponses[0].declarationId, findResponses[1].declarationId);
});

Deno.test('ApiExcludeEndpoint() marks the operation entry as excluded', () => {
  const metadata = getMetadata<ApiOperationMetadata[]>(API_OPERATION_METADATA, OperationController.prototype);

  assertExists(metadata);
  assertEquals(stripDeclarationId(metadata).find((entry) => entry.functionName === 'internal'), { functionName: 'internal', excluded: true });
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

  assertExists(baseMetadata);
  assertExists(childAMetadata);
  assertExists(childBMetadata);
  assertEquals(stripDeclarationId(baseMetadata), [{ functionName: 'action', summary: 'base' }]);
  assertEquals(stripDeclarationId(childAMetadata), [
    { functionName: 'action', summary: 'base' },
    { functionName: 'action', summary: 'child-a' },
  ]);
  assertEquals(stripDeclarationId(childBMetadata), [
    { functionName: 'action', summary: 'base' },
    { functionName: 'action', summary: 'child-b' },
  ]);

  // Same declaration-identity guarantee @ApiOperation() relies on: the
  // inherited entry matches the base's own declaration everywhere, while
  // each override's own entry is distinct from it and from its sibling's.
  assertEquals(childAMetadata[0].declarationId, baseMetadata[0].declarationId);
  assertEquals(childBMetadata[0].declarationId, baseMetadata[0].declarationId);
  assertEquals(childAMetadata[1].declarationId === baseMetadata[0].declarationId, false);
  assertEquals(childAMetadata[1].declarationId === childBMetadata[1].declarationId, false);
});
