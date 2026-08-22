import { assertStrictEquals, assertThrows } from '@std/assert';

import { Injectable } from '../decorators/injectable.ts';
import { createInjector, inject } from './injector.util.ts';

@Injectable()
class _SingletonService {}

class _SingletonConsumerA {
  constructor(readonly service = inject(_SingletonService)) {}
}

@Injectable()
class _SingletonConsumerB {
  constructor(readonly service = inject(_SingletonService)) {}
}

@Injectable()
class _SingletonRoot {
  constructor(
    readonly consumerA = inject(_SingletonConsumerA),
    readonly consumerB = inject(_SingletonConsumerB),
  ) {}
}

@Injectable()
class _MissingProviderConsumer {
  constructor(readonly service = inject(_SingletonService)) {}
}

@Injectable()
class _RootOnlyConsumer {
  constructor(readonly service = inject(_SingletonService)) {}
}

@Injectable()
class _ExplicitTokenService {}

const EXPLICIT_TOKEN = Symbol('explicit-token');
const EXPLICIT_TOKEN_2 = Symbol('explicit-token-2');

@Injectable({ implementing: [EXPLICIT_TOKEN, EXPLICIT_TOKEN_2] })
class _ExplicitTokenImplementation extends _ExplicitTokenService {}

@Injectable()
class _ExplicitTokenConsumer {
  constructor(readonly service = inject<_ExplicitTokenService>(EXPLICIT_TOKEN)) {}
}

@Injectable()
class _ExplicitTokenConsumerTwo {
  constructor(readonly service = inject<_ExplicitTokenService>(EXPLICIT_TOKEN_2)) {}
}

@Injectable()
class _ExplicitTokenRoot {
  constructor(
    readonly consumerA = inject(_ExplicitTokenConsumer),
    readonly consumerB = inject(_ExplicitTokenConsumerTwo),
  ) {}
}

@Injectable({ isSingleton: false })
class _NonSingletonProvider {}

Deno.test('inject() reuses singleton services within the same object graph', () => {
  const root = createInjector([_SingletonService, _SingletonConsumerA, _SingletonConsumerB]).resolve(_SingletonRoot);

  assertStrictEquals(root.consumerA.service, root.consumerB.service);
});

Deno.test('createInjector() resolves implementing tokens through explicit Needle inject()', () => {
  const consumer = createInjector([_ExplicitTokenImplementation]).resolve(_ExplicitTokenConsumer);

  assertStrictEquals(consumer.service instanceof _ExplicitTokenImplementation, true);
});

Deno.test('createInjector() resolves multiple implementing tokens to the same singleton provider', () => {
  const root = createInjector([_ExplicitTokenImplementation, _ExplicitTokenConsumer, _ExplicitTokenConsumerTwo]).resolve(_ExplicitTokenRoot);

  assertStrictEquals(root.consumerA.service instanceof _ExplicitTokenImplementation, true);
  assertStrictEquals(root.consumerA.service, root.consumerB.service);
});

Deno.test('createInjector() resolves root classes that are not listed as providers', () => {
  const consumer = createInjector([_SingletonService]).resolve(_RootOnlyConsumer);

  assertStrictEquals(consumer.service instanceof _SingletonService, true);
});

Deno.test('createInjector() throws when an explicit Needle dependency is not provided', () => {
  let error: unknown;

  try {
    createInjector([]).resolve(_MissingProviderConsumer);
  } catch (caughtError) {
    error = caughtError;
  }

  assertStrictEquals(error instanceof Error, true);
  assertStrictEquals((error as Error).message.includes('No provider(s) found'), true);
});

Deno.test('createInjector() rejects providers marked with isSingleton: false', () => {
  const error = assertThrows(() => createInjector([_NonSingletonProvider])) as Error;

  assertStrictEquals(error.message, 'Provider _NonSingletonProvider uses isSingleton: false, but explicit Needle injection only supports singleton providers.');
});

@Injectable()
class _ScopeSharedSingleton {
  readonly id = crypto.randomUUID();
}

class _ScopedConsumer {
  constructor(readonly shared = inject(_ScopeSharedSingleton)) {}
}

Deno.test('createScope() returns a fresh instance per scope, while still resolving the parent injector singletons', () => {
  const rootInjector = createInjector([_ScopeSharedSingleton]);

  const requestOneScope = rootInjector.createScope();
  const requestTwoScope = rootInjector.createScope();

  const consumerOne = requestOneScope.resolve(_ScopedConsumer);
  const consumerTwo = requestTwoScope.resolve(_ScopedConsumer);

  assertStrictEquals(consumerOne === consumerTwo, false);
  assertStrictEquals(consumerOne.shared, consumerTwo.shared);
  assertStrictEquals(consumerOne.shared, rootInjector.resolve(_ScopeSharedSingleton));
});

Deno.test('createScope() resolves the same instance for repeated resolves within one scope', () => {
  const rootInjector = createInjector([_ScopeSharedSingleton]);
  const requestScope = rootInjector.createScope();

  assertStrictEquals(requestScope.resolve(_ScopedConsumer), requestScope.resolve(_ScopedConsumer));
});
