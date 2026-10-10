import assert from 'node:assert/strict';
import { test } from 'node:test';
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

  assert.ok(response);

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

test('assignModule() exposes controller routes', async () => {
  const response = await handleModuleRequest(BasicModule, '/health/ping');

  assert.deepEqual(response.status, 200);
  assert.deepEqual(await response.text(), 'pong');
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

test('assignModule() composes routePrefix values across nested modules', async () => {
  const response = await handleModuleRequest(NestedRootModule, '/root-prefix/mid-prefix/leaf-prefix/leaf/ping');

  assert.deepEqual(response.status, 200);
  assert.deepEqual(await response.text(), 'nested');
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

test('assignModule() does not leak controller deduplication across separate router builds', async () => {
  const firstResponse = await handleModuleRequest(RepeatedModule, '/repeat-prefix/repeat/ping');
  const secondResponse = await handleModuleRequest(RepeatedModule, '/repeat-prefix/repeat/ping');

  assert.deepEqual(firstResponse.status, 200);
  assert.deepEqual(await firstResponse.text(), 'repeat');
  assert.deepEqual(secondResponse.status, 200);
  assert.deepEqual(await secondResponse.text(), 'repeat');
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

test('assignModule() registers distinct controllers even when they share the same class name', async () => {
  const firstResponse = await handleModuleRequest(DuplicateNameModule, '/first-duplicate/ping');
  const secondResponse = await handleModuleRequest(DuplicateNameModule, '/second-duplicate/ping');

  assert.deepEqual(firstResponse.status, 200);
  assert.deepEqual(await firstResponse.text(), 'first');
  assert.deepEqual(secondResponse.status, 200);
  assert.deepEqual(await secondResponse.text(), 'second');
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

test('assignModule() aggregates deduplicated providers across nested modules', async () => {
  const app = assignModule(ProviderRootModule);

  const parentResponse = await app.request('/parent/id');
  const childResponse = await app.request('/child/id');

  assert.ok(parentResponse);
  assert.ok(childResponse);

  const parentId = await parentResponse.text();
  const childId = await childResponse.text();

  assert.deepEqual(parentResponse.status, 200);
  assert.deepEqual(childResponse.status, 200);
  assert.deepEqual(parentId, childId);
});

class MissingModuleMetadata {}

test('assignModule() throws a clear error when @Module() metadata is missing', () => {
  assert.throws(() => assignModule(MissingModuleMetadata as unknown as ClassConstructor), {
    message: 'Module MissingModuleMetadata is missing @Module() metadata.',
  });
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

test('scoped() resolves a fresh instance per request, while shared module singletons stay stable', async () => {
  const app = assignModule(ScopedModule);

  const firstResponse = await app.request('/widgets/current');
  const secondResponse = await app.request('/widgets/current');

  assert.deepEqual(firstResponse.status, 200);
  assert.deepEqual(secondResponse.status, 200);

  const first = await firstResponse.json();
  const second = await secondResponse.json();

  assert.deepEqual(first.widgetId === second.widgetId, false);
  assert.deepEqual(first.sharedId, second.sharedId);
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

test('initModule()/destroyModule() init a lifecycle provider before a controller that depends on it, and tear down in reverse, leaving providers without hooks lazily unconstructed', async () => {
  lifecycleEvents.length = 0;

  const app = assignModule(LifecycleModule);

  // Nothing runs just from assignModule() — hooks are opt-in, run only once explicitly awaited.
  assert.equal(lifecycleEvents.length, 0);

  await initModule(app);
  // LifecycleController's constructor injects LifecycleProvider — the provider's own
  // onModuleInit() (e.g. opening a DB connection) must have already run by the time the
  // controller's onModuleInit() runs, or the controller would observe a not-yet-initialized dependency.
  assert.deepEqual(lifecycleEvents, ['LifecycleProvider:init', 'LifecycleController:init']);

  await destroyModule(app);
  assert.deepEqual(lifecycleEvents, ['LifecycleProvider:init', 'LifecycleController:init', 'LifecycleController:destroy', 'LifecycleProvider:destroy']);

  // UnusedLazyProvider implements neither hook and nothing injects it — it must never be constructed.
  assert.deepEqual(lifecycleEvents.includes('UnusedLazyProvider:constructed'), false);
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

test('initModule() propagates an error thrown by a hook', async () => {
  const app = assignModule(ThrowingInitModule);

  await assert.rejects(() => initModule(app), { message: 'boom-init' });
});

const asyncControllerState = { initialized: false, destroyed: false };

@Controller('async-lifecycle')
class AsyncLifecycleController implements OnModuleInit, OnModuleDestroy {
  @Get('ping')
  ping() {
    return 'pong';
  }

  async onModuleInit(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 10));
    asyncControllerState.initialized = true;
  }

  async onModuleDestroy(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 10));
    asyncControllerState.destroyed = true;
  }
}

@Module({ controllers: [AsyncLifecycleController] })
class AsyncLifecycleModule {}

test('initModule()/destroyModule() await async hooks on a controller, without any request being sent', async () => {
  const app = assignModule(AsyncLifecycleModule);

  await initModule(app);
  assert.deepEqual(asyncControllerState, { initialized: true, destroyed: false });

  await destroyModule(app);
  assert.deepEqual(asyncControllerState, { initialized: true, destroyed: true });
});

@Controller('throwing-controller')
class ThrowingInitAsyncController implements OnModuleInit {
  @Get('ping')
  ping() {
    return 'pong';
  }

  async onModuleInit(): Promise<void> {
    await Promise.resolve();
    throw new Error('boom-controller-init');
  }
}

@Module({ controllers: [ThrowingInitAsyncController] })
class ThrowingInitAsyncControllerModule {}

test('initModule() propagates an error thrown by an async controller hook', async () => {
  const app = assignModule(ThrowingInitAsyncControllerModule);

  await assert.rejects(() => initModule(app), { message: 'boom-controller-init' });
  assert.deepEqual(isModuleReady(app), false);
});

test('initModule()/destroyModule()/isModuleReady()/healthCheck() throw a clear error when given a Hono instance not returned by assignModule()', async () => {
  const app = new Hono();
  const message = 'initModule()/destroyModule()/isModuleReady()/healthCheck() must be called with the exact Hono instance returned by assignModule().';

  await assert.rejects(() => initModule(app), { message });
  await assert.rejects(() => destroyModule(app), { message });
  assert.throws(() => isModuleReady(app), { message });
  // getModuleLifecycle() throws before the handler ever touches its Context argument.
  assert.throws(() => healthCheck(app)(undefined as never), { message });
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

test('healthCheck() responds 503 before initModule(), 200 after, and 503 again once destroyModule() starts', async () => {
  const honestApp = assignModule(ReadyCheckModule);
  const testApp = new Hono();
  testApp.get('/health', healthCheck(honestApp));

  const beforeResponse = await testApp.request('/health');
  assert.deepEqual(beforeResponse.status, 503);
  assert.deepEqual(await beforeResponse.json(), { status: 'unavailable' });

  await initModule(honestApp);

  const afterInitResponse = await testApp.request('/health');
  assert.deepEqual(afterInitResponse.status, 200);
  assert.deepEqual(await afterInitResponse.json(), { status: 'ok' });

  await destroyModule(honestApp);

  const afterDestroyResponse = await testApp.request('/health');
  assert.deepEqual(afterDestroyResponse.status, 503);
});

test('isModuleReady() mirrors initModule()/destroyModule() directly', async () => {
  const app = assignModule(ReadyCheckModule);

  assert.deepEqual(isModuleReady(app), false);

  await initModule(app);
  assert.deepEqual(isModuleReady(app), true);

  await destroyModule(app);
  assert.deepEqual(isModuleReady(app), false);
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

test('isModuleReady() stays false when initModule() throws', async () => {
  const app = assignModule(ThrowingReadyModule);

  await assert.rejects(() => initModule(app));
  assert.deepEqual(isModuleReady(app), false);
});
