import '../utils/reflect-shim.ts';

import { INJECTABLE_OPTIONS_METADATA, INJECTOR_INTERFACES_METADATA } from '../const.ts';
import { inject } from '../utils/injector.util.ts';
import { defineMetadata } from '../utils/metadata.util.ts';

export type Implementing = string | symbol | string[] | symbol[];
export type ImplementingOptions = { implementing?: Implementing };
export type InjectableOptions = ImplementingOptions & { isSingleton?: boolean };

export { inject };

/**
 * Injectable decorator
 *
 * @param {ImplementingOptions} options - Implementing options
 */
export function Injectable<T extends abstract new (...args: never[]) => object>({ implementing = [], isSingleton }: InjectableOptions = {}): (target: T, context: ClassDecoratorContext<T>) => void {
  const implementings = Array.isArray(implementing) ? implementing : [implementing];

  return (target: T, _context: ClassDecoratorContext<T>) => {
    if (implementings.length > 0) {
      defineMetadata(INJECTOR_INTERFACES_METADATA, implementings, target);
    }

    defineMetadata(INJECTABLE_OPTIONS_METADATA, {
      isSingleton: isSingleton !== false,
    }, target);
  };
}
