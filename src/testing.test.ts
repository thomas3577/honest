import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Controller } from './decorators/controller.decorator.ts';
import { Get } from './decorators/http-methods.decorator.ts';
import { inject, Injectable } from './decorators/injectable.ts';
import { createTestApp } from './testing.ts';

interface Greeter {
  greet(): string;
}

const GREETER = Symbol('greeter');

@Injectable({ implementing: GREETER })
class RealService implements Greeter {
  greet(): string {
    return 'real';
  }
}

@Injectable({ implementing: GREETER })
class MockService implements Greeter {
  greet(): string {
    return 'mock';
  }
}

@Controller('greet')
class GreetController {
  constructor(private readonly service = inject<Greeter>(GREETER)) {}

  @Get()
  get() {
    return this.service.greet();
  }
}

test('createTestApp() mounts controllers and resolves dependencies like assignModule()', async () => {
  const app = createTestApp({ controllers: [GreetController], providers: [RealService] });
  const response = await app.request('/greet');

  assert.ok(response);
  assert.deepEqual(response.status, 200);
  assert.deepEqual(await response.text(), 'real');
});

test('createTestApp() lets a test-double provider stand in for the real one via the same implementing token', async () => {
  const app = createTestApp({ controllers: [GreetController], providers: [MockService] });
  const response = await app.request('/greet');

  assert.deepEqual(await response.text(), 'mock');
});
