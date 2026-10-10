import assert from 'node:assert/strict';
import { test } from 'node:test';

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

test('ApiTags() is discoverable regardless of decoration order relative to Controller()', () => {
  assert.deepEqual(getMetadata<string[]>(API_TAGS_METADATA, TaggedAfterController.prototype), ['users', 'admin']);
  assert.deepEqual(getMetadata<string[]>(API_TAGS_METADATA, TaggedBeforeController.prototype), ['users']);
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

test('ApiOperation() records summary/description metadata per method', () => {
  const metadata = getMetadata<ApiOperationMetadata[]>(API_OPERATION_METADATA, OperationController.prototype);

  assert.ok(metadata);
  assert.deepEqual(stripDeclarationId(metadata).find((entry) => entry.functionName === 'list'), {
    functionName: 'list',
    summary: 'List items',
    description: 'Returns all items.',
  });
});

test('ApiResponse() is stackable, recording one entry per call', () => {
  const metadata = getMetadata<ApiResponseMetadata[]>(API_RESPONSE_METADATA, OperationController.prototype);

  assert.ok(metadata);
  const findResponses = metadata.filter((entry) => entry.functionName === 'find');
  assert.deepEqual(stripDeclarationId(findResponses), [
    { functionName: 'find', status: 404, description: 'Not found' },
    { functionName: 'find', status: 200, description: 'OK' },
  ]);
  // Both responses were declared on the same @Get(':id') method, so they
  // share the same declarationId — this is what lets buildOpenApiDocument()
  // attribute both to that one route.
  assert.deepEqual(findResponses[0].declarationId, findResponses[1].declarationId);
});

test('ApiExcludeEndpoint() marks the operation entry as excluded', () => {
  const metadata = getMetadata<ApiOperationMetadata[]>(API_OPERATION_METADATA, OperationController.prototype);

  assert.ok(metadata);
  assert.deepEqual(stripDeclarationId(metadata).find((entry) => entry.functionName === 'internal'), { functionName: 'internal', excluded: true });
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

test('ApiOperation() does not leak metadata between sibling subclasses of a shared base', () => {
  const baseMetadata = getMetadata<ApiOperationMetadata[]>(API_OPERATION_METADATA, ApiSiblingBaseController.prototype);
  const childAMetadata = getMetadata<ApiOperationMetadata[]>(API_OPERATION_METADATA, ApiSiblingChildAController.prototype);
  const childBMetadata = getMetadata<ApiOperationMetadata[]>(API_OPERATION_METADATA, ApiSiblingChildBController.prototype);

  assert.ok(baseMetadata);
  assert.ok(childAMetadata);
  assert.ok(childBMetadata);
  assert.deepEqual(stripDeclarationId(baseMetadata), [{ functionName: 'action', summary: 'base' }]);
  assert.deepEqual(stripDeclarationId(childAMetadata), [
    { functionName: 'action', summary: 'base' },
    { functionName: 'action', summary: 'child-a' },
  ]);
  assert.deepEqual(stripDeclarationId(childBMetadata), [
    { functionName: 'action', summary: 'base' },
    { functionName: 'action', summary: 'child-b' },
  ]);

  // Same declaration-identity guarantee @ApiOperation() relies on: the
  // inherited entry matches the base's own declaration everywhere, while
  // each override's own entry is distinct from it and from its sibling's.
  assert.deepEqual(childAMetadata[0].declarationId, baseMetadata[0].declarationId);
  assert.deepEqual(childBMetadata[0].declarationId, baseMetadata[0].declarationId);
  assert.deepEqual(childAMetadata[1].declarationId === baseMetadata[0].declarationId, false);
  assert.deepEqual(childAMetadata[1].declarationId === childBMetadata[1].declarationId, false);
});

test('ApiOperation() throws when applied to a static method', () => {
  assert.throws(
    () => {
      class _Test {
        @ApiOperation({ summary: 'x' })
        static handler() {}
      }
    },
    { message: '@ApiOperation() can only be used on public instance methods.' },
  );
});

test('ApiOperation() throws when applied to a private method', () => {
  assert.throws(
    () => {
      class _Test {
        @ApiOperation({ summary: 'x' })
        #handler() {}
      }
    },
    { message: '@ApiOperation() can only be used on public instance methods.' },
  );
});

test('ApiOperation() throws when applied to a getter', () => {
  assert.throws(
    () => {
      // deno-lint-ignore no-explicit-any -- deliberately misapplying a method decorator to a getter to exercise the runtime guard.
      const apiOperationOnGetter: any = ApiOperation({ summary: 'x' });

      class _Test {
        @apiOperationOnGetter
        get handler() {
          return 1;
        }
      }
    },
    { message: '@ApiOperation() can only be used on public instance methods.' },
  );
});

test('ApiOperation() throws when applied to a symbol-named method', () => {
  assert.throws(
    () => {
      class _Test {
        @ApiOperation({ summary: 'x' })
        [Symbol.iterator]() {}
      }
    },
    { message: '@ApiOperation() can only be used on public instance methods.' },
  );
});

test('ApiResponse() throws when applied to a static method', () => {
  assert.throws(
    () => {
      class _Test {
        @ApiResponse({ status: 200 })
        static handler() {}
      }
    },
    { message: '@ApiResponse() can only be used on public instance methods.' },
  );
});

test('ApiResponse() throws when applied to a private method', () => {
  assert.throws(
    () => {
      class _Test {
        @ApiResponse({ status: 200 })
        #handler() {}
      }
    },
    { message: '@ApiResponse() can only be used on public instance methods.' },
  );
});

test('ApiResponse() throws when applied to a getter', () => {
  assert.throws(
    () => {
      // deno-lint-ignore no-explicit-any -- deliberately misapplying a method decorator to a getter to exercise the runtime guard.
      const apiResponseOnGetter: any = ApiResponse({ status: 200 });

      class _Test {
        @apiResponseOnGetter
        get handler() {
          return 1;
        }
      }
    },
    { message: '@ApiResponse() can only be used on public instance methods.' },
  );
});

test('ApiResponse() throws when applied to a symbol-named method', () => {
  assert.throws(
    () => {
      class _Test {
        @ApiResponse({ status: 200 })
        [Symbol.iterator]() {}
      }
    },
    { message: '@ApiResponse() can only be used on public instance methods.' },
  );
});

test('ApiExcludeEndpoint() throws when applied to a static method', () => {
  assert.throws(
    () => {
      class _Test {
        @ApiExcludeEndpoint()
        static handler() {}
      }
    },
    { message: '@ApiExcludeEndpoint() can only be used on public instance methods.' },
  );
});

test('ApiExcludeEndpoint() throws when applied to a private method', () => {
  assert.throws(
    () => {
      class _Test {
        @ApiExcludeEndpoint()
        #handler() {}
      }
    },
    { message: '@ApiExcludeEndpoint() can only be used on public instance methods.' },
  );
});

test('ApiExcludeEndpoint() throws when applied to a getter', () => {
  assert.throws(
    () => {
      // deno-lint-ignore no-explicit-any -- deliberately misapplying a method decorator to a getter to exercise the runtime guard.
      const apiExcludeEndpointOnGetter: any = ApiExcludeEndpoint();

      class _Test {
        @apiExcludeEndpointOnGetter
        get handler() {
          return 1;
        }
      }
    },
    { message: '@ApiExcludeEndpoint() can only be used on public instance methods.' },
  );
});

test('ApiExcludeEndpoint() throws when applied to a symbol-named method', () => {
  assert.throws(
    () => {
      class _Test {
        @ApiExcludeEndpoint()
        [Symbol.iterator]() {}
      }
    },
    { message: '@ApiExcludeEndpoint() can only be used on public instance methods.' },
  );
});
