import { assertEquals, assertExists, assertThrows } from '@std/assert';

import { METHOD_METADATA } from '../const.ts';
import type { ActionMetadata } from '../types.ts';
import { getMetadata } from '../utils/metadata.util.ts';
import { body, param, query } from './route-params.decorator.ts';
import { Controller } from './controller.decorator.ts';
import { All, Delete, Get, Patch, Post, Put } from './http-methods.decorator.ts';

/** `declarationId` is an opaque, run-order-dependent identity (see `getMethodDeclarationId()`) — strip it before comparing the rest of the metadata shape. */
const stripDeclarationId = (list: ActionMetadata[]) => list.map(({ declarationId: _declarationId, ...rest }) => rest);

@Controller()
class HttpMethodController {
  @Get('list')
  list() {}

  @Post('create')
  create() {}

  @Put('replace')
  replace() {}

  @Patch('update')
  update() {}

  @Delete('remove')
  remove() {}

  @All()
  fallback() {}
}

Deno.test('HTTP method decorators register method metadata for each decorated handler', () => {
  const metadata = getMetadata<ActionMetadata[]>(METHOD_METADATA, HttpMethodController.prototype);

  assertExists(metadata);
  assertEquals(stripDeclarationId(metadata), [
    { path: 'list', method: 'get', functionName: 'list' },
    { path: 'create', method: 'post', functionName: 'create' },
    { path: 'replace', method: 'put', functionName: 'replace' },
    { path: 'update', method: 'patch', functionName: 'update' },
    { path: 'remove', method: 'delete', functionName: 'remove' },
    { path: '', method: 'all', functionName: 'fallback' },
  ]);
});

@Controller()
class ResolverMethodController {
  @Post(':id', [param<string>('id'), body<{ name: string }>(), query<string | null>('dryRun')])
  create(_id: string, _body: { name: string }, _dryRun: string | null) {}
}

Deno.test('HTTP method decorators store optional args resolvers', () => {
  const metadata = getMetadata<ActionMetadata[]>(METHOD_METADATA, ResolverMethodController.prototype);

  assertExists(metadata);
  assertEquals(stripDeclarationId(metadata), [
    {
      path: ':id',
      method: 'post',
      functionName: 'create',
      args: [
        { paramType: 6, data: 'id' },
        { paramType: 4, data: undefined },
        { paramType: 5, data: 'dryRun' },
      ],
    },
  ]);
});

@Controller()
class ArgsOnlyOverloadController {
  @Get([param<string>('id')])
  find(_id: string) {}
}

Deno.test('HTTP method decorators support the args-only overload (no explicit path)', () => {
  const metadata = getMetadata<ActionMetadata[]>(METHOD_METADATA, ArgsOnlyOverloadController.prototype);

  assertExists(metadata);
  assertEquals(stripDeclarationId(metadata), [
    { path: '', method: 'get', functionName: 'find', args: [{ paramType: 6, data: 'id' }] },
  ]);
});

@Controller()
class SiblingBaseController {
  @Get('base-path')
  action() {}
}

@Controller()
class SiblingChildAController extends SiblingBaseController {
  @Get('child-a-path')
  override action() {}
}

@Controller()
class SiblingChildBController extends SiblingBaseController {
  @Get('child-b-path')
  override action() {}
}

Deno.test('HTTP method decorators do not leak route metadata between sibling subclasses of a shared base', () => {
  const baseMetadata = getMetadata<ActionMetadata[]>(METHOD_METADATA, SiblingBaseController.prototype);
  const childAMetadata = getMetadata<ActionMetadata[]>(METHOD_METADATA, SiblingChildAController.prototype);
  const childBMetadata = getMetadata<ActionMetadata[]>(METHOD_METADATA, SiblingChildBController.prototype);

  // Each subclass clones and appends onto its inherited metadata (matching the
  // Controller() middleware-inheritance semantics), but must never see its
  // sibling's own entries.
  assertExists(baseMetadata);
  assertExists(childAMetadata);
  assertExists(childBMetadata);
  assertEquals(stripDeclarationId(baseMetadata), [{ path: 'base-path', method: 'get', functionName: 'action' }]);
  assertEquals(stripDeclarationId(childAMetadata), [
    { path: 'base-path', method: 'get', functionName: 'action' },
    { path: 'child-a-path', method: 'get', functionName: 'action' },
  ]);
  assertEquals(stripDeclarationId(childBMetadata), [
    { path: 'base-path', method: 'get', functionName: 'action' },
    { path: 'child-b-path', method: 'get', functionName: 'action' },
  ]);

  // The inherited (base) entry is the exact same declaration everywhere it
  // appears, but each subclass's own override is a distinct declaration —
  // this identity is what buildOpenApiDocument() relies on to tell an
  // inherited route apart from an overriding one that shares a functionName.
  assertEquals(childAMetadata[0].declarationId, baseMetadata[0].declarationId);
  assertEquals(childBMetadata[0].declarationId, baseMetadata[0].declarationId);
  assertEquals(childAMetadata[1].declarationId === baseMetadata[0].declarationId, false);
  assertEquals(childBMetadata[1].declarationId === baseMetadata[0].declarationId, false);
  assertEquals(childAMetadata[1].declarationId === childBMetadata[1].declarationId, false);
});

Deno.test('Get() throws when applied to a static method', () => {
  assertThrows(
    () => {
      class _Test {
        @Get('path')
        static handler() {}
      }
    },
    Error,
    '@GET() can only be used on public instance methods.',
  );
});

Deno.test('Get() throws when applied to a private method', () => {
  assertThrows(
    () => {
      class _Test {
        @Get('path')
        #handler() {}
      }
    },
    Error,
    '@GET() can only be used on public instance methods.',
  );
});

Deno.test('Get() throws when applied to a getter', () => {
  assertThrows(
    () => {
      // deno-lint-ignore no-explicit-any -- deliberately misapplying a method decorator to a getter to exercise the runtime guard.
      const getOnGetter: any = Get('path');

      class _Test {
        @getOnGetter
        get handler() {
          return 1;
        }
      }
    },
    Error,
    '@GET() can only be used on public instance methods.',
  );
});

Deno.test('Get() throws when applied to a symbol-named method', () => {
  assertThrows(
    () => {
      class _Test {
        @Get('path')
        [Symbol.iterator]() {}
      }
    },
    Error,
    '@GET() only supports string-named methods.',
  );
});
