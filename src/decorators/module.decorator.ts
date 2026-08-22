import '../utils/reflect-shim.ts';

import { MODULE_METADATA } from '../const.ts';
import type { ClassConstructor, CreateRouterOption } from '../types.ts';
import { defineMetadata } from '../utils/metadata.util.ts';

/**
 * Module decorator
 *
 * @param {CreateRouterOption} data - Module data
 */
export function Module<T>(data: CreateRouterOption): (target: ClassConstructor<T>, context: ClassDecoratorContext<ClassConstructor<T>>) => void {
  return (target: ClassConstructor<T>, _context: ClassDecoratorContext<ClassConstructor<T>>) => {
    defineMetadata(MODULE_METADATA, data, target.prototype);
  };
}
