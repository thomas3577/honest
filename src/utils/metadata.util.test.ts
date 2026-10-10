import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createMetadataDecorator, defineMetadata, getMetadata, getOwnMetadata } from './metadata.util.ts';
import './reflect-shim.ts';

type StandardMetadataDecoratorContext<This = object, Value = unknown> =
  | ClassDecoratorContext
  | ClassMethodDecoratorContext<This, (this: This, ...args: unknown[]) => unknown>
  | ClassGetterDecoratorContext<This, () => Value>
  | ClassSetterDecoratorContext<This, (value: Value) => void>
  | ClassAccessorDecoratorContext<This, Value>
  | ClassFieldDecoratorContext<This, Value>;

type ReflectMetadataApi = typeof Reflect & {
  defineMetadata?: (metadataKey: string | symbol, value: unknown, target: object, propertyKey?: string | symbol) => void;
  getMetadata?: <T>(metadataKey: string | symbol, target: object, propertyKey?: string | symbol) => T | undefined;
  getOwnMetadata?: <T>(metadataKey: string | symbol, target: object, propertyKey?: string | symbol) => T | undefined;
  metadata?: {
    (metadataKey: string | symbol, value: unknown): {
      (target: object, propertyKey?: string | symbol): void;
      <This extends object, Value>(value: Value, context: StandardMetadataDecoratorContext<This, Value>): void;
    };
  };
};

const reflectApi = Reflect as ReflectMetadataApi;

test('defineMetadata() and getOwnMetadata() store class metadata on the exact target', () => {
  const classKey = Symbol('class-key');

  class MetadataBase {
    method() {}
  }

  class MetadataChild extends MetadataBase {
    override method() {}
  }

  defineMetadata(classKey, 'base-value', MetadataBase.prototype);

  assert.deepEqual(getOwnMetadata(classKey, MetadataBase.prototype), 'base-value');
  assert.deepEqual(getOwnMetadata(classKey, MetadataChild.prototype), undefined);
});

test('defineMetadata() and getOwnMetadata() store member metadata on the exact target', () => {
  const memberKey = Symbol('member-key');

  class MetadataBase {
    method() {}
  }

  class MetadataChild extends MetadataBase {
    override method() {}
  }

  defineMetadata(memberKey, 'member-value', MetadataBase.prototype, 'method');

  assert.deepEqual(getOwnMetadata(memberKey, MetadataBase.prototype, 'method'), 'member-value');
  assert.deepEqual(getOwnMetadata(memberKey, MetadataChild.prototype, 'method'), undefined);
});

test('getMetadata() resolves class and member metadata through the prototype chain', () => {
  const classKey = Symbol('class-key');
  const memberKey = Symbol('member-key');

  class MetadataBase {
    method() {}
  }

  class MetadataChild extends MetadataBase {
    override method() {}
  }

  defineMetadata(classKey, 'inherited-class', MetadataBase.prototype);
  defineMetadata(memberKey, 'inherited-member', MetadataBase.prototype, 'method');

  assert.deepEqual(getMetadata(classKey, MetadataChild.prototype), 'inherited-class');
  assert.deepEqual(getMetadata(memberKey, MetadataChild.prototype, 'method'), 'inherited-member');
});

test('createMetadataDecorator() writes metadata for class members', () => {
  const decoratorKey = Symbol('decorator-key');

  class MetadataBase {
    method() {}
  }

  const decorator = createMetadataDecorator(decoratorKey, 'decorated-value');

  decorator(MetadataBase.prototype, 'method');

  assert.deepEqual(getMetadata(decoratorKey, MetadataBase.prototype, 'method'), 'decorated-value');
});

test('reflect shim exposes metadata helpers backed by the internal store', () => {
  const shimKey = Symbol('shim-key');

  class MetadataBase {
    method() {}
  }

  class MetadataChild extends MetadataBase {
    override method() {}
  }

  reflectApi.defineMetadata?.(shimKey, 'shim-class', MetadataBase.prototype);
  reflectApi.defineMetadata?.(shimKey, 'shim-member', MetadataBase.prototype, 'method');

  assert.deepEqual(reflectApi.getOwnMetadata?.(shimKey, MetadataBase.prototype), 'shim-class');
  assert.deepEqual(reflectApi.getMetadata?.(shimKey, MetadataChild.prototype), 'shim-class');
  assert.deepEqual(reflectApi.getOwnMetadata?.(shimKey, MetadataBase.prototype, 'method'), 'shim-member');
  assert.deepEqual(reflectApi.getMetadata?.(shimKey, MetadataChild.prototype, 'method'), 'shim-member');
});

test('reflect shim metadata() decorator writes through to the shared metadata store', () => {
  const shimKey = Symbol('shim-key');

  class MetadataChild {
    method() {}
  }

  const shimDecorator = reflectApi.metadata?.(shimKey, 'shim-decorator');

  assert.equal(typeof shimDecorator, 'function');

  shimDecorator?.(MetadataChild.prototype, 'method');

  assert.deepEqual(getMetadata(shimKey, MetadataChild.prototype, 'method'), 'shim-decorator');
});

test('reflect shim metadata() supports standard decorators on methods and classes', () => {
  const classKey = Symbol('class-key');
  const methodKey = Symbol('method-key');
  const metadataDecorator = reflectApi.metadata as NonNullable<ReflectMetadataApi['metadata']>;

  @metadataDecorator(classKey, 'class-metadata')
  class MetadataBase {
    @metadataDecorator(methodKey, 'method-metadata')
    method() {}
  }

  class MetadataChild extends MetadataBase {
    override method() {}
  }

  assert.deepEqual(getOwnMetadata(classKey, MetadataBase), 'class-metadata');
  assert.deepEqual(getMetadata(classKey, MetadataChild), 'class-metadata');
  assert.deepEqual(getOwnMetadata(methodKey, MetadataBase.prototype, 'method'), 'method-metadata');
  assert.deepEqual(getOwnMetadata(methodKey, MetadataChild.prototype, 'method'), undefined);
  assert.deepEqual(getMetadata(methodKey, MetadataChild.prototype, 'method'), 'method-metadata');
});
