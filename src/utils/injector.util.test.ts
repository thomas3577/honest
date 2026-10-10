import assert from 'node:assert/strict';
import { test } from 'node:test';

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

test('inject() reuses singleton services within the same object graph', () => {
  const root = createInjector([_SingletonService, _SingletonConsumerA, _SingletonConsumerB]).resolve(_SingletonRoot);

  assert.equal(root.consumerA.service, root.consumerB.service);
});

test('createInjector() resolves implementing tokens through explicit Needle inject()', () => {
  const consumer = createInjector([_ExplicitTokenImplementation]).resolve(_ExplicitTokenConsumer);

  assert.equal(consumer.service instanceof _ExplicitTokenImplementation, true);
});

test('createInjector() resolves multiple implementing tokens to the same singleton provider', () => {
  const root = createInjector([_ExplicitTokenImplementation, _ExplicitTokenConsumer, _ExplicitTokenConsumerTwo]).resolve(_ExplicitTokenRoot);

  assert.equal(root.consumerA.service instanceof _ExplicitTokenImplementation, true);
  assert.equal(root.consumerA.service, root.consumerB.service);
});

test('createInjector() resolves root classes that are not listed as providers', () => {
  const consumer = createInjector([_SingletonService]).resolve(_RootOnlyConsumer);

  assert.equal(consumer.service instanceof _SingletonService, true);
});

test('createInjector() throws when an explicit Needle dependency is not provided', () => {
  let error: unknown;

  try {
    createInjector([]).resolve(_MissingProviderConsumer);
  } catch (caughtError) {
    error = caughtError;
  }

  assert.equal(error instanceof Error, true);
  assert.equal((error as Error).message.includes('No provider(s) found'), true);
});

test('createInjector() rejects providers marked with isSingleton: false', () => {
  assert.throws(() => createInjector([_NonSingletonProvider]), {
    message: 'Provider _NonSingletonProvider uses isSingleton: false, but explicit Needle injection only supports singleton providers.',
  });
});

@Injectable()
class _ScopeSharedSingleton {
  readonly id = crypto.randomUUID();
}

class _ScopedConsumer {
  constructor(readonly shared = inject(_ScopeSharedSingleton)) {}
}

test('createScope() returns a fresh instance per scope, while still resolving the parent injector singletons', () => {
  const rootInjector = createInjector([_ScopeSharedSingleton]);

  const requestOneScope = rootInjector.createScope();
  const requestTwoScope = rootInjector.createScope();

  const consumerOne = requestOneScope.resolve(_ScopedConsumer);
  const consumerTwo = requestTwoScope.resolve(_ScopedConsumer);

  assert.equal(consumerOne === consumerTwo, false);
  assert.equal(consumerOne.shared, consumerTwo.shared);
  assert.equal(consumerOne.shared, rootInjector.resolve(_ScopeSharedSingleton));
});

test('createScope() resolves the same instance for repeated resolves within one scope', () => {
  const rootInjector = createInjector([_ScopeSharedSingleton]);
  const requestScope = rootInjector.createScope();

  assert.equal(requestScope.resolve(_ScopedConsumer), requestScope.resolve(_ScopedConsumer));
});
