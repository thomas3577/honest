import { assertEquals } from '@std/assert';

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

Deno.test('Injectable() defaults to singleton metadata', () => {
  assertEquals(getMetadata(INJECTABLE_OPTIONS_METADATA, DefaultInjectable), {
    isSingleton: true,
  });
});

Deno.test('Injectable() stores explicit isSingleton: false metadata', () => {
  assertEquals(getMetadata(INJECTABLE_OPTIONS_METADATA, NonSingletonInjectable), {
    isSingleton: false,
  });
});

Deno.test('Injectable() normalizes a single implementing token into metadata', () => {
  assertEquals(getMetadata(INJECTOR_INTERFACES_METADATA, SingleTokenInjectable), [TOKEN_A]);
});

Deno.test('Injectable() preserves multiple implementing tokens', () => {
  assertEquals(getMetadata(INJECTOR_INTERFACES_METADATA, MultiTokenInjectable), [TOKEN_A, TOKEN_B]);
});

Deno.test('Injectable() leaves implementing metadata unset when no token is provided', () => {
  assertEquals(getMetadata(INJECTOR_INTERFACES_METADATA, DefaultInjectable), undefined);
});
