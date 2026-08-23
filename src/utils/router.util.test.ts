import { assertEquals, assertExists, assertRejects, assertThrows } from '@std/assert';
import { Hono } from 'hono';

import { Controller } from '../decorators/controller.decorator.ts';
import { Get } from '../decorators/http-methods.decorator.ts';
import { inject, Injectable } from '../decorators/injectable.ts';
import { Module } from '../decorators/module.decorator.ts';
import { scoped } from '../decorators/route-params.decorator.ts';
import type { ClassConstructor, OnModuleDestroy, OnModuleInit } from '../types.ts';
import { assignModule, destroyModule, healthCheck, initModule, isModuleReady } from './router.util.ts';

const handleModuleRequest = async (module: ClassConstructor, path: string) => {
  const app = assignModule(module);
  const response = await app.request(path);

  assertExists(response);

  return response;
};

@Controller('health')
class BasicController {
  @Get('ping')
  ping() {
    return 'pong';
  }
}

@Module({ controllers: [BasicController] })
class BasicModule {}

Deno.test('assignModule() exposes controller routes', async () => {
  const response = await handleModuleRequest(BasicModule, '/health/ping');

  assertEquals(response.status, 200);
  assertEquals(await response.text(), 'pong');
});

@Controller('leaf')
class LeafController {
  @Get('ping')
  ping() {
    return 'nested';
  }
}

@Module({ controllers: [LeafController], routePrefix: '/leaf-prefix' })
class LeafModule {}

@Module({ modules: [LeafModule], routePrefix: '/mid-prefix/' })
class MidModule {}

@Module({ modules: [MidModule], routePrefix: 'root-prefix/' })
class NestedRootModule {}

Deno.test('assignModule() composes routePrefix values across nested modules', async () => {
  const response = await handleModuleRequest(NestedRootModule, '/root-prefix/mid-prefix/leaf-prefix/leaf/ping');

  assertEquals(response.status, 200);
  assertEquals(await response.text(), 'nested');
});

@Controller('repeat')
class RepeatedController {
  @Get('ping')
  ping() {
    return 'repeat';
  }
}

@Module({ controllers: [RepeatedController], routePrefix: 'repeat-prefix' })
class RepeatedModule {}

Deno.test('assignModule() does not leak controller deduplication across separate router builds', async () => {
  const firstResponse = await handleModuleRequest(RepeatedModule, '/repeat-prefix/repeat/ping');
  const secondResponse = await handleModuleRequest(RepeatedModule, '/repeat-prefix/repeat/ping');

  assertEquals(firstResponse.status, 200);
  assertEquals(await firstResponse.text(), 'repeat');
  assertEquals(secondResponse.status, 200);
  assertEquals(await secondResponse.text(), 'repeat');
});

const FirstDuplicateController = (() => {
  @Controller('first-duplicate')
  class DuplicateController {
    @Get('ping')
    ping() {
      return 'first';
    }
  }

  return DuplicateController;
})();

const SecondDuplicateController = (() => {
  @Controller('second-duplicate')
  class DuplicateController {
    @Get('ping')
    ping() {
      return 'second';
    }
  }

  return DuplicateController;
})();

@Module({ controllers: [FirstDuplicateController, SecondDuplicateController] })
class DuplicateNameModule {}

Deno.test('assignModule() registers distinct controllers even when they share the same class name', async () => {
  const firstResponse = await handleModuleRequest(DuplicateNameModule, '/first-duplicate/ping');
  const secondResponse = await handleModuleRequest(DuplicateNameModule, '/second-duplicate/ping');

  assertEquals(firstResponse.status, 200);
  assertEquals(await firstResponse.text(), 'first');
  assertEquals(secondResponse.status, 200);
  assertEquals(await secondResponse.text(), 'second');
});

@Injectable()
class SharedProvider {
  readonly id = crypto.randomUUID();
}

@Controller('parent')
class ParentProviderController {
  constructor(readonly shared = inject(SharedProvider)) {}

  @Get('id')
  id() {
    return this.shared.id;
  }
}

@Controller('child')
class ChildProviderController {
  constructor(readonly shared = inject(SharedProvider)) {}

  @Get('id')
  id() {
    return this.shared.id;
  }
}

@Module({ controllers: [ChildProviderController], providers: [SharedProvider] })
class ProviderChildModule {}

@Module({ controllers: [ParentProviderController], providers: [SharedProvider], modules: [ProviderChildModule] })
class ProviderRootModule {}

Deno.test('assignModule() aggregates deduplicated providers across nested modules', async () => {
  const app = assignModule(ProviderRootModule);

  const parentResponse = await app.request('/parent/id');
  const childResponse = await app.request('/child/id');

  assertExists(parentResponse);
  assertExists(childResponse);

  const parentId = await parentResponse.text();
  const childId = await childResponse.text();

  assertEquals(parentResponse.status, 200);
  assertEquals(childResponse.status, 200);
  assertEquals(parentId, childId);
});

class MissingModuleMetadata {}

Deno.test('assignModule() throws a clear error when @Module() metadata is missing', () => {
  const error = assertThrows(() => assignModule(MissingModuleMetadata as unknown as ClassConstructor)) as Error;

  assertEquals(error.message, 'Module MissingModuleMetadata is missing @Module() metadata.');
});

@Injectable()
class ScopeSharedProvider {
  readonly id = crypto.randomUUID();
}

class RequestScopedWidget {
  readonly id = crypto.randomUUID();

  constructor(readonly shared = inject(ScopeSharedProvider)) {}
}

@Controller('widgets')
class ScopedController {
  @Get('current', [scoped(RequestScopedWidget)])
  current(widget: RequestScopedWidget) {
    return { widgetId: widget.id, sharedId: widget.shared.id };
  }
}

@Module({ controllers: [ScopedController], providers: [ScopeSharedProvider] })
class ScopedModule {}

Deno.test('scoped() resolves a fresh instance per request, while shared module singletons stay stable', async () => {
  const app = assignModule(ScopedModule);

  const firstResponse = await app.request('/widgets/current');
  const secondResponse = await app.request('/widgets/current');

  assertEquals(firstResponse.status, 200);
  assertEquals(secondResponse.status, 200);

  const first = await firstResponse.json();
  const second = await secondResponse.json();

  assertEquals(first.widgetId === second.widgetId, false);
  assertEquals(first.sharedId, second.sharedId);
});

const lifecycleEvents: string[] = [];

@Injectable()
class UnusedLazyProvider {
  constructor() {
    lifecycleEvents.push('UnusedLazyProvider:constructed');
  }
}

@Injectable()
class LifecycleProvider implements OnModuleInit, OnModuleDestroy {
  onModuleInit(): void {
    lifecycleEvents.push('LifecycleProvider:init');
  }

  onModuleDestroy(): void {
    lifecycleEvents.push('LifecycleProvider:destroy');
  }
}

@Controller('lifecycle')
class LifecycleController implements OnModuleInit, OnModuleDestroy {
  constructor(private readonly provider = inject(LifecycleProvider)) {}

  @Get('ping')
  ping() {
    return 'pong';
  }

  onModuleInit(): void {
    lifecycleEvents.push('LifecycleController:init');
  }

  onModuleDestroy(): void {
    lifecycleEvents.push('LifecycleController:destroy');
  }
}

@Module({ controllers: [LifecycleController], providers: [LifecycleProvider, UnusedLazyProvider] })
class LifecycleModule {}

Deno.test('initModule()/destroyModule() init a lifecycle provider before a controller that depends on it, and tear down in reverse, leaving providers without hooks lazily unconstructed', async () => {
  lifecycleEvents.length = 0;

  const app = assignModule(LifecycleModule);

  // Nothing runs just from assignModule() — hooks are opt-in, run only once explicitly awaited.
  assertEquals(lifecycleEvents, []);

  await initModule(app);
  // LifecycleController's constructor injects LifecycleProvider — the provider's own
  // onModuleInit() (e.g. opening a DB connection) must have already run by the time the
  // controller's onModuleInit() runs, or the controller would observe a not-yet-initialized dependency.
  assertEquals(lifecycleEvents, ['LifecycleProvider:init', 'LifecycleController:init']);

  await destroyModule(app);
  assertEquals(lifecycleEvents, ['LifecycleProvider:init', 'LifecycleController:init', 'LifecycleController:destroy', 'LifecycleProvider:destroy']);

  // UnusedLazyProvider implements neither hook and nothing injects it — it must never be constructed.
  assertEquals(lifecycleEvents.includes('UnusedLazyProvider:constructed'), false);
});

@Injectable()
class ThrowingInitProvider implements OnModuleInit {
  onModuleInit(): void {
    throw new Error('boom-init');
  }
}

@Controller('throwing')
class ThrowingInitController {
  constructor(private readonly provider = inject(ThrowingInitProvider)) {}

  @Get('ping')
  ping() {
    return 'pong';
  }
}

@Module({ controllers: [ThrowingInitController], providers: [ThrowingInitProvider] })
class ThrowingInitModule {}

Deno.test('initModule() propagates an error thrown by a hook', async () => {
  const app = assignModule(ThrowingInitModule);

  await assertRejects(() => initModule(app), Error, 'boom-init');
});

Deno.test('initModule()/destroyModule()/isModuleReady()/healthCheck() throw a clear error when given a Hono instance not returned by assignModule()', async () => {
  const app = new Hono();
  const message = 'initModule()/destroyModule()/isModuleReady()/healthCheck() must be called with the exact Hono instance returned by assignModule().';

  await assertRejects(() => initModule(app), Error, message);
  await assertRejects(() => destroyModule(app), Error, message);
  assertThrows(() => isModuleReady(app), Error, message);
  // getModuleLifecycle() throws before the handler ever touches its Context argument.
  assertThrows(() => healthCheck(app)(undefined as never), Error, message);
});

@Controller('ready-check')
class ReadyCheckController {
  @Get('ping')
  ping() {
    return 'pong';
  }
}

@Module({ controllers: [ReadyCheckController] })
class ReadyCheckModule {}

Deno.test('healthCheck() responds 503 before initModule(), 200 after, and 503 again once destroyModule() starts', async () => {
  const honestApp = assignModule(ReadyCheckModule);
  const testApp = new Hono();
  testApp.get('/health', healthCheck(honestApp));

  const beforeResponse = await testApp.request('/health');
  assertEquals(beforeResponse.status, 503);
  assertEquals(await beforeResponse.json(), { status: 'unavailable' });

  await initModule(honestApp);

  const afterInitResponse = await testApp.request('/health');
  assertEquals(afterInitResponse.status, 200);
  assertEquals(await afterInitResponse.json(), { status: 'ok' });

  await destroyModule(honestApp);

  const afterDestroyResponse = await testApp.request('/health');
  assertEquals(afterDestroyResponse.status, 503);
});

Deno.test('isModuleReady() mirrors initModule()/destroyModule() directly', async () => {
  const app = assignModule(ReadyCheckModule);

  assertEquals(isModuleReady(app), false);

  await initModule(app);
  assertEquals(isModuleReady(app), true);

  await destroyModule(app);
  assertEquals(isModuleReady(app), false);
});

@Injectable()
class ThrowingReadyProvider implements OnModuleInit {
  onModuleInit(): void {
    throw new Error('boom-ready');
  }
}

@Controller('throwing-ready')
class ThrowingReadyController {
  constructor(private readonly provider = inject(ThrowingReadyProvider)) {}

  @Get('ping')
  ping() {
    return 'pong';
  }
}

@Module({ controllers: [ThrowingReadyController], providers: [ThrowingReadyProvider] })
class ThrowingReadyModule {}

Deno.test('isModuleReady() stays false when initModule() throws', async () => {
  const app = assignModule(ThrowingReadyModule);

  await assertRejects(() => initModule(app));
  assertEquals(isModuleReady(app), false);
});
