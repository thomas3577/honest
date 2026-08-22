import { Container, inject as needleInject } from '@needle-di/core';

import { INJECTABLE_OPTIONS_METADATA, INJECTOR_INTERFACES_METADATA } from '../const.ts';
import type { ClassConstructor } from '../types.ts';
import { getMetadata } from './metadata.util.ts';

type InjectableMetadata = {
  implementing: Array<string | symbol>;
  isSingleton: boolean;
};

type InjectableOptions = {
  isSingleton?: boolean;
};

const getInjectableMetadata = (target: ClassConstructor): InjectableMetadata => {
  const implementing = getMetadata<Array<string | symbol>>(INJECTOR_INTERFACES_METADATA, target) || [];
  const options: InjectableOptions = getMetadata(INJECTABLE_OPTIONS_METADATA, target) || {};

  return {
    implementing,
    isSingleton: options.isSingleton !== false,
  };
};

export class NeedleInjector {
  #container: Container;
  #boundTokens = new Set<unknown>();

  constructor(private readonly providers: ClassConstructor[] = [], parent?: Container) {
    this.#container = new Container(parent);
    this.providers.forEach((provider) => this.#bindProvider(provider));
  }

  resolve<T extends object>(target: ClassConstructor<T>): T {
    this.#bindClass(target, false);

    return this.#container.get(target);
  }

  /**
   * Creates a child injector backed by a fresh needle-di child container.
   * Anything not explicitly (re-)provided here transparently falls back to
   * this injector's own container, so a scoped provider can safely
   * `inject(...)` this injector's singletons while still getting its own
   * fresh instance per scope (e.g. per HTTP request — see `scoped()` in
   * decorators/route-params.decorator.ts).
   */
  createScope(providers: ClassConstructor[] = []): NeedleInjector {
    return new NeedleInjector(providers, this.#container);
  }

  #bindProvider(provider: ClassConstructor): void {
    this.#bindClass(provider, true);

    const { implementing } = getInjectableMetadata(provider);

    implementing.forEach((token) => this.#bindAlias(token, provider));
  }

  #bindClass(target: ClassConstructor, isProvider: boolean): void {
    if (this.#boundTokens.has(target)) {
      return;
    }

    const { isSingleton } = getInjectableMetadata(target);

    if (isProvider && !isSingleton) {
      throw new Error(`Provider ${target.name} uses isSingleton: false, but explicit Needle injection only supports singleton providers.`);
    }

    this.#container.bind({
      provide: target,
      useClass: target,
    });

    this.#boundTokens.add(target);
  }

  #bindAlias(token: string | symbol, provider: ClassConstructor): void {
    if (this.#boundTokens.has(token)) {
      return;
    }

    this.#container.bind({
      provide: token as never,
      useExisting: provider as never,
    });

    this.#boundTokens.add(token);
  }
}

export const createInjector = (providers: ClassConstructor[] = []): NeedleInjector => new NeedleInjector(providers);

export { needleInject as inject };
