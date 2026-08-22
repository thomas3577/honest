type MetadataTarget = object;
type MetadataKey = string | symbol;
type MetadataPropertyKey = string | symbol;
type DecoratorMetadataBag = Record<PropertyKey, unknown>;
type StandardMetadataStore = {
  classMetadata: Map<MetadataKey, unknown>;
  instanceMemberMetadata: Map<MetadataPropertyKey, Map<MetadataKey, unknown>>;
  staticMemberMetadata: Map<MetadataPropertyKey, Map<MetadataKey, unknown>>;
};
type StandardMetadataDecoratorContext = {
  kind: string;
  name?: string | symbol;
  private?: boolean;
  static?: boolean;
  metadata: DecoratorMetadataBag;
};

const classMetadataStore = new WeakMap<MetadataTarget, Map<MetadataKey, unknown>>();
const memberMetadataStore = new WeakMap<MetadataTarget, Map<MetadataPropertyKey, Map<MetadataKey, unknown>>>();
const standardMetadataStoreKey = Symbol('standardMetadataStore');

const getOrCreateClassMetadata = (target: MetadataTarget): Map<MetadataKey, unknown> => {
  let metadata = classMetadataStore.get(target);

  if (!metadata) {
    metadata = new Map<MetadataKey, unknown>();
    classMetadataStore.set(target, metadata);
  }

  return metadata;
};

const getOrCreateMemberMetadata = (target: MetadataTarget, propertyKey: MetadataPropertyKey): Map<MetadataKey, unknown> => {
  let properties = memberMetadataStore.get(target);

  if (!properties) {
    properties = new Map<MetadataPropertyKey, Map<MetadataKey, unknown>>();
    memberMetadataStore.set(target, properties);
  }

  let metadata = properties.get(propertyKey);

  if (!metadata) {
    metadata = new Map<MetadataKey, unknown>();
    properties.set(propertyKey, metadata);
  }

  return metadata;
};

const getOwnMetadataValue = <T>(metadataKey: MetadataKey, target: MetadataTarget, propertyKey?: MetadataPropertyKey): T | undefined => {
  if (propertyKey === undefined) {
    return classMetadataStore.get(target)?.get(metadataKey) as T | undefined;
  }

  return memberMetadataStore.get(target)?.get(propertyKey)?.get(metadataKey) as T | undefined;
};

const isMetadataTarget = (value: unknown): value is MetadataTarget => {
  return (typeof value === 'object' && value !== null) || typeof value === 'function';
};

const isStandardMetadataDecoratorContext = (value: unknown): value is StandardMetadataDecoratorContext => {
  return typeof value === 'object' && value !== null && 'kind' in value && 'metadata' in value;
};

const getOrCreateStandardMetadataStore = (metadata: DecoratorMetadataBag): StandardMetadataStore => {
  let store = metadata[standardMetadataStoreKey] as StandardMetadataStore | undefined;

  if (!store) {
    store = {
      classMetadata: new Map<MetadataKey, unknown>(),
      instanceMemberMetadata: new Map<MetadataPropertyKey, Map<MetadataKey, unknown>>(),
      staticMemberMetadata: new Map<MetadataPropertyKey, Map<MetadataKey, unknown>>(),
    };
    metadata[standardMetadataStoreKey] = store;
  }

  return store;
};

const getStandardMetadataStore = (target: MetadataTarget, ownOnly = false): StandardMetadataStore | undefined => {
  const metadataOwner = typeof target === 'function' ? target : target.constructor;

  if (!isMetadataTarget(metadataOwner)) {
    return undefined;
  }

  if (ownOnly && !Object.hasOwn(metadataOwner, Symbol.metadata)) {
    return undefined;
  }

  const metadata = (metadataOwner as { [Symbol.metadata]?: DecoratorMetadataBag })[Symbol.metadata];

  return metadata?.[standardMetadataStoreKey] as StandardMetadataStore | undefined;
};

const getStandardMetadataValue = <T>(metadataKey: MetadataKey, target: MetadataTarget, propertyKey?: MetadataPropertyKey, ownOnly = false): T | undefined => {
  const store = getStandardMetadataStore(target, ownOnly);

  if (!store) {
    return undefined;
  }

  if (propertyKey === undefined) {
    return store.classMetadata.get(metadataKey) as T | undefined;
  }

  // For backwards compatibility, check instance members first, then static members
  // This maintains the previous behavior where both were in one map
  const instanceValue = store.instanceMemberMetadata.get(propertyKey)?.get(metadataKey) as T | undefined;
  if (instanceValue !== undefined) {
    return instanceValue;
  }

  return store.staticMemberMetadata.get(propertyKey)?.get(metadataKey) as T | undefined;
};

export const defineMetadata = <T>(metadataKey: MetadataKey, value: T, target: MetadataTarget, propertyKey?: MetadataPropertyKey): void => {
  if (propertyKey === undefined) {
    getOrCreateClassMetadata(target).set(metadataKey, value);

    return;
  }

  getOrCreateMemberMetadata(target, propertyKey).set(metadataKey, value);
};

export const getOwnMetadata = <T>(metadataKey: MetadataKey, target: MetadataTarget, propertyKey?: MetadataPropertyKey): T | undefined => {
  return getOwnMetadataValue<T>(metadataKey, target, propertyKey) ?? getStandardMetadataValue<T>(metadataKey, target, propertyKey, true);
};

export const getMetadata = <T>(metadataKey: MetadataKey, target: MetadataTarget, propertyKey?: MetadataPropertyKey): T | undefined => {
  let current: object | null = target;

  while (current) {
    const value = getOwnMetadataValue<T>(metadataKey, current, propertyKey) ?? getStandardMetadataValue<T>(metadataKey, current, propertyKey);

    if (value !== undefined) {
      return value;
    }

    current = Object.getPrototypeOf(current);
  }

  return undefined;
};

export const createMetadataDecorator = (metadataKey: MetadataKey, value: unknown) => {
  return (targetOrValue: unknown, propertyKeyOrContext?: MetadataPropertyKey | StandardMetadataDecoratorContext) => {
    if (isStandardMetadataDecoratorContext(propertyKeyOrContext)) {
      const context = propertyKeyOrContext;
      const metadata = getOrCreateStandardMetadataStore(context.metadata);

      if (context.kind === 'class') {
        metadata.classMetadata.set(metadataKey, value);

        return;
      }

      if (context.private || (typeof context.name !== 'string' && typeof context.name !== 'symbol')) {
        throw new Error('Reflect.metadata() only supports public class elements when used as a standard decorator.');
      }

      const memberMap = context.static ? metadata.staticMemberMetadata : metadata.instanceMemberMetadata;
      let memberMetadata = memberMap.get(context.name);

      if (!memberMetadata) {
        memberMetadata = new Map<MetadataKey, unknown>();
        memberMap.set(context.name, memberMetadata);
      }

      memberMetadata.set(metadataKey, value);

      return;
    }

    if (!isMetadataTarget(targetOrValue)) {
      throw new TypeError('Reflect.metadata() decorator target must be an object.');
    }

    defineMetadata(metadataKey, value, targetOrValue, propertyKeyOrContext as MetadataPropertyKey | undefined);
  };
};
