/**
 * Testing utilities — imported separately (`@dx/honest/testing`) so the
 * main entry point stays free of test-only code.
 *
 * @module
 */

import type { Hono } from 'hono';

import { Module } from './decorators/module.decorator.ts';
import { assignModule } from './utils/router.util.ts';
import type { CreateRouterOption } from './types.ts';

/**
 * Builds a throwaway module from `options` and assigns it, exactly like
 * `@Module(options) class TestModule {}` followed by `assignModule(TestModule)` —
 * saving the boilerplate of declaring a named module class in every test.
 * Works with everything `assignModule()` does (dependency injection,
 * request scope, providers), so a mock/test-double class works as a
 * provider the same way a real one would.
 *
 * ```ts
 * const app = createTestApp({ controllers: [UsersController], providers: [MockUserService] });
 * const response = await app.request('/users');
 * ```
 */
export function createTestApp(options: CreateRouterOption): Hono {
  @Module(options)
  class TestModule {}

  return assignModule(TestModule);
}
