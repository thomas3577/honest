import { assertEquals, assertExists } from '@std/assert';

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

Deno.test('createTestApp() mounts controllers and resolves dependencies like assignModule()', async () => {
  const app = createTestApp({ controllers: [GreetController], providers: [RealService] });
  const response = await app.request('/greet');

  assertExists(response);
  assertEquals(response.status, 200);
  assertEquals(await response.text(), 'real');
});

Deno.test('createTestApp() lets a test-double provider stand in for the real one via the same implementing token', async () => {
  const app = createTestApp({ controllers: [GreetController], providers: [MockService] });
  const response = await app.request('/greet');

  assertEquals(await response.text(), 'mock');
});
