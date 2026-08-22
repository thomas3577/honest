import { assertEquals, assertStrictEquals } from '@std/assert';

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

Deno.test('defineMetadata() and getOwnMetadata() store class metadata on the exact target', () => {
  const classKey = Symbol('class-key');

  class MetadataBase {
    method() {}
  }

  class MetadataChild extends MetadataBase {
    override method() {}
  }

  defineMetadata(classKey, 'base-value', MetadataBase.prototype);

  assertEquals(getOwnMetadata(classKey, MetadataBase.prototype), 'base-value');
  assertEquals(getOwnMetadata(classKey, MetadataChild.prototype), undefined);
});

Deno.test('defineMetadata() and getOwnMetadata() store member metadata on the exact target', () => {
  const memberKey = Symbol('member-key');

  class MetadataBase {
    method() {}
  }

  class MetadataChild extends MetadataBase {
    override method() {}
  }

  defineMetadata(memberKey, 'member-value', MetadataBase.prototype, 'method');

  assertEquals(getOwnMetadata(memberKey, MetadataBase.prototype, 'method'), 'member-value');
  assertEquals(getOwnMetadata(memberKey, MetadataChild.prototype, 'method'), undefined);
});

Deno.test('getMetadata() resolves class and member metadata through the prototype chain', () => {
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

  assertEquals(getMetadata(classKey, MetadataChild.prototype), 'inherited-class');
  assertEquals(getMetadata(memberKey, MetadataChild.prototype, 'method'), 'inherited-member');
});

Deno.test('createMetadataDecorator() writes metadata for class members', () => {
  const decoratorKey = Symbol('decorator-key');

  class MetadataBase {
    method() {}
  }

  const decorator = createMetadataDecorator(decoratorKey, 'decorated-value');

  decorator(MetadataBase.prototype, 'method');

  assertEquals(getMetadata(decoratorKey, MetadataBase.prototype, 'method'), 'decorated-value');
});

Deno.test('reflect shim exposes metadata helpers backed by the internal store', () => {
  const shimKey = Symbol('shim-key');

  class MetadataBase {
    method() {}
  }

  class MetadataChild extends MetadataBase {
    override method() {}
  }

  reflectApi.defineMetadata?.(shimKey, 'shim-class', MetadataBase.prototype);
  reflectApi.defineMetadata?.(shimKey, 'shim-member', MetadataBase.prototype, 'method');

  assertEquals(reflectApi.getOwnMetadata?.(shimKey, MetadataBase.prototype), 'shim-class');
  assertEquals(reflectApi.getMetadata?.(shimKey, MetadataChild.prototype), 'shim-class');
  assertEquals(reflectApi.getOwnMetadata?.(shimKey, MetadataBase.prototype, 'method'), 'shim-member');
  assertEquals(reflectApi.getMetadata?.(shimKey, MetadataChild.prototype, 'method'), 'shim-member');
});

Deno.test('reflect shim metadata() decorator writes through to the shared metadata store', () => {
  const shimKey = Symbol('shim-key');

  class MetadataChild {
    method() {}
  }

  const shimDecorator = reflectApi.metadata?.(shimKey, 'shim-decorator');

  assertStrictEquals(typeof shimDecorator, 'function');

  shimDecorator?.(MetadataChild.prototype, 'method');

  assertEquals(getMetadata(shimKey, MetadataChild.prototype, 'method'), 'shim-decorator');
});

Deno.test('reflect shim metadata() supports standard decorators on methods and classes', () => {
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

  assertEquals(getOwnMetadata(classKey, MetadataBase), 'class-metadata');
  assertEquals(getMetadata(classKey, MetadataChild), 'class-metadata');
  assertEquals(getOwnMetadata(methodKey, MetadataBase.prototype, 'method'), 'method-metadata');
  assertEquals(getOwnMetadata(methodKey, MetadataChild.prototype, 'method'), undefined);
  assertEquals(getMetadata(methodKey, MetadataChild.prototype, 'method'), 'method-metadata');
});
