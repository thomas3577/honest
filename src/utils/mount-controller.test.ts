import { assertExists } from '@std/assert';
import { Hono } from 'hono';

import { errorHandler } from './error-handler.util.ts';
import type { ControllerClass } from '../types.ts';

/**
 * Mounts a single controller instance directly, bypassing `assignModule()` —
 * for tests that only need routing/middleware behavior and don't require
 * dependency injection or a request scope. Shared by `controller.decorator.test.ts`
 * and `guard.decorator.test.ts`.
 */
export function mountController(controller: ControllerClass, routePrefix?: string): Hono {
  controller.init(routePrefix);

  assertExists(controller.path);
  assertExists(controller.route);

  const app = new Hono();

  app.route(controller.path || '/', controller.route);
  app.onError(errorHandler());

  return app;
}
