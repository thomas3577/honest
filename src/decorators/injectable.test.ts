import assert from 'node:assert/strict';
import { test } from 'node:test';

import { INJECTABLE_OPTIONS_METADATA, INJECTOR_INTERFACES_METADATA } from '../const.ts';
import { getMetadata } from '../utils/metadata.util.ts';
import { Injectable } from './injectable.ts';

const TOKEN_A = Symbol('token-a');
const TOKEN_B = Symbol('token-b');

@Injectable()
class DefaultInjectable {}

@Injectable({ isSingleton: false })
class NonSingletonInjectable {}

@Injectable({ implementing: TOKEN_A })
class SingleTokenInjectable {}

@Injectable({ implementing: [TOKEN_A, TOKEN_B] })
class MultiTokenInjectable {}

test('Injectable() defaults to singleton metadata', () => {
  assert.deepEqual(getMetadata(INJECTABLE_OPTIONS_METADATA, DefaultInjectable), {
    isSingleton: true,
  });
});

test('Injectable() stores explicit isSingleton: false metadata', () => {
  assert.deepEqual(getMetadata(INJECTABLE_OPTIONS_METADATA, NonSingletonInjectable), {
    isSingleton: false,
  });
});

test('Injectable() normalizes a single implementing token into metadata', () => {
  assert.deepEqual(getMetadata(INJECTOR_INTERFACES_METADATA, SingleTokenInjectable), [TOKEN_A]);
});

test('Injectable() preserves multiple implementing tokens', () => {
  assert.deepEqual(getMetadata(INJECTOR_INTERFACES_METADATA, MultiTokenInjectable), [TOKEN_A, TOKEN_B]);
});

test('Injectable() leaves implementing metadata unset when no token is provided', () => {
  assert.deepEqual(getMetadata(INJECTOR_INTERFACES_METADATA, DefaultInjectable), undefined);
});
