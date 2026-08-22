import { createMetadataDecorator, defineMetadata, getMetadata, getOwnMetadata } from './metadata.util.ts';

type StandardMetadataDecoratorContext<This = object, Value = unknown> =
  | ClassDecoratorContext
  | ClassMethodDecoratorContext<This, (this: This, ...args: unknown[]) => unknown>
  | ClassGetterDecoratorContext<This, () => Value>
  | ClassSetterDecoratorContext<This, (value: Value) => void>
  | ClassAccessorDecoratorContext<This, Value>
  | ClassFieldDecoratorContext<This, Value>;

type MetadataDecorator = {
  (target: object, propertyKey?: string | symbol): void;
  <This extends object, Value>(value: Value, context: StandardMetadataDecoratorContext<This, Value>): void;
};

type ReflectMetadataApi = typeof Reflect & {
  defineMetadata?: (metadataKey: string | symbol, value: unknown, target: object, propertyKey?: string | symbol) => void;
  getMetadata?: <T>(metadataKey: string | symbol, target: object, propertyKey?: string | symbol) => T | undefined;
  getOwnMetadata?: <T>(metadataKey: string | symbol, target: object, propertyKey?: string | symbol) => T | undefined;
  metadata?: (metadataKey: string | symbol, value: unknown) => MetadataDecorator;
};

const reflectApi = Reflect as ReflectMetadataApi;

if (!reflectApi.defineMetadata) {
  reflectApi.defineMetadata = defineMetadata;
}

if (!reflectApi.getMetadata) {
  reflectApi.getMetadata = getMetadata;
}

if (!reflectApi.getOwnMetadata) {
  reflectApi.getOwnMetadata = getOwnMetadata;
}

if (!reflectApi.metadata) {
  reflectApi.metadata = createMetadataDecorator;
}

export {};
