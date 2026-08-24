import { assertEquals, assertExists } from '@std/assert';
import type { Context } from 'hono';

import { HttpError } from '../errors.ts';
import { errorHandler } from '../utils/error-handler.util.ts';
import { assignModule } from '../utils/router.util.ts';
import { mountController } from '../utils/mount-controller.test.ts';
import type { ControllerClass } from '../types.ts';
import { Controller } from './controller.decorator.ts';
import type { Guard } from './guard.decorator.ts';
import { UseGuard } from './guard.decorator.ts';
import { Get } from './http-methods.decorator.ts';
import { inject, Injectable } from './injectable.ts';
import { Module } from './module.decorator.ts';

class AllowGuard implements Guard {
  canActivate(): boolean {
    return true;
  }
}

class DenyGuard implements Guard {
  canActivate(): boolean {
    return false;
  }
}

@Controller('method-guard')
class MethodGuardController {
  @UseGuard(AllowGuard)
  @Get('allowed')
  allowed() {
    return 'ok';
  }

  @UseGuard(DenyGuard)
  @Get('denied')
  denied() {
    return 'ok';
  }
}

@Module({ controllers: [MethodGuardController] })
class MethodGuardModule {}

Deno.test('@UseGuard() on a method allows or denies based on canActivate()', async () => {
  const app = assignModule(MethodGuardModule);
  app.onError(errorHandler());

  const allowedResponse = await app.request('/method-guard/allowed');
  assertEquals(allowedResponse.status, 200);

  const deniedResponse = await app.request('/method-guard/denied');
  assertEquals(deniedResponse.status, 403);
  assertEquals(await deniedResponse.json(), { error: 'Forbidden' });
});

@UseGuard(DenyGuard)
@Controller('class-guard')
class ClassGuardController {
  @Get('one')
  one() {
    return 'one';
  }

  @Get('two')
  two() {
    return 'two';
  }
}

@Module({ controllers: [ClassGuardController] })
class ClassGuardModule {}

Deno.test('@UseGuard() on a controller class applies to every route on it', async () => {
  const app = assignModule(ClassGuardModule);
  app.onError(errorHandler());

  const oneResponse = await app.request('/class-guard/one');
  const twoResponse = await app.request('/class-guard/two');

  assertEquals(oneResponse.status, 403);
  assertEquals(twoResponse.status, 403);
});

Deno.test('a controller-wide @UseGuard() does not run for requests that never match one of its routes', async () => {
  const app = assignModule(ClassGuardModule);
  app.onError(errorHandler());

  // No route is registered for this sub-path — must 404, not 403, and must
  // not leak that a guard exists here at all.
  const unmappedResponse = await app.request('/class-guard/does-not-exist');
  assertEquals(unmappedResponse.status, 404);

  // No OPTIONS handler is registered for this route — an unauthenticated
  // CORS preflight must not be denied by the guard.
  const preflightResponse = await app.request('/class-guard/one', { method: 'OPTIONS' });
  assertEquals(preflightResponse.status, 404);
});

@UseGuard(AllowGuard)
@Controller('stacked-guard')
class StackedGuardController {
  @UseGuard(DenyGuard)
  @Get('blocked')
  blocked() {
    return 'nope';
  }

  @Get('open')
  open() {
    return 'ok';
  }
}

@Module({ controllers: [StackedGuardController] })
class StackedGuardModule {}

Deno.test('@UseGuard() stacks a class-level and a method-level guard — either one denying is enough to deny', async () => {
  const app = assignModule(StackedGuardModule);
  app.onError(errorHandler());

  const blockedResponse = await app.request('/stacked-guard/blocked');
  const openResponse = await app.request('/stacked-guard/open');

  assertEquals(blockedResponse.status, 403);
  assertEquals(openResponse.status, 200);
});

@Injectable()
class PermissionService {
  isAdmin(c: Context): boolean {
    return c.req.header('x-role') === 'admin';
  }
}

class RoleGuard implements Guard {
  constructor(private readonly permissions = inject(PermissionService)) {}

  canActivate(c: Context): boolean {
    return this.permissions.isAdmin(c);
  }
}

@Controller('role-guard')
class RoleGuardController {
  @UseGuard(RoleGuard)
  @Get('secret')
  secret() {
    return 'top secret';
  }
}

@Module({ controllers: [RoleGuardController], providers: [PermissionService] })
class RoleGuardModule {}

Deno.test('UseGuard() resolves the guard through the request scope, so it can inject() module providers', async () => {
  const app = assignModule(RoleGuardModule);
  app.onError(errorHandler());

  const deniedResponse = await app.request('/role-guard/secret');
  assertEquals(deniedResponse.status, 403);

  const allowedResponse = await app.request('/role-guard/secret', { headers: { 'x-role': 'admin' } });
  assertEquals(allowedResponse.status, 200);
  assertEquals(await allowedResponse.text(), 'top secret');
});

class CustomDenyGuard implements Guard {
  canActivate(): boolean {
    throw new HttpError(401, 'Unauthorized', { reason: 'missing token' });
  }
}

@Controller('custom-guard')
class CustomGuardController {
  @UseGuard(CustomDenyGuard)
  @Get('secure')
  secure() {
    return 'ok';
  }
}

@Module({ controllers: [CustomGuardController] })
class CustomGuardModule {}

Deno.test('a guard can throw its own HttpError instead of the default 403', async () => {
  const app = assignModule(CustomGuardModule);
  app.onError(errorHandler());

  const response = await app.request('/custom-guard/secure');
  assertEquals(response.status, 401);
  assertEquals(await response.json(), { error: 'Unauthorized', details: { reason: 'missing token' } });
});

@Controller('bare-guard')
class BareGuardController {
  @UseGuard(AllowGuard)
  @Get()
  get() {
    return 'ok';
  }
}

Deno.test('UseGuard() throws a clear error when the controller was not mounted via assignModule()', async () => {
  const app = mountController(new BareGuardController() as unknown as ControllerClass);
  const response = await app.request('/bare-guard');

  assertExists(response);
  assertEquals(response.status, 500);
});

@UseGuard(AllowGuard)
@Controller()
class GuardSiblingBaseController {
  @Get('base-path')
  action() {
    return 'base';
  }
}

@UseGuard(DenyGuard)
@Controller()
class GuardSiblingChildAController extends GuardSiblingBaseController {
  @Get('child-a-path')
  override action() {
    return 'child-a';
  }
}

@Controller()
class GuardSiblingChildBController extends GuardSiblingBaseController {
  @Get('child-b-path')
  override action() {
    return 'child-b';
  }
}

@Module({ controllers: [GuardSiblingBaseController] })
class GuardSiblingBaseModule {}

@Module({ controllers: [GuardSiblingChildAController] })
class GuardSiblingChildAModule {}

@Module({ controllers: [GuardSiblingChildBController] })
class GuardSiblingChildBModule {}

Deno.test('class-level @UseGuard() does not leak between sibling subclasses of a shared base', async () => {
  const baseApp = assignModule(GuardSiblingBaseModule);
  const childAApp = assignModule(GuardSiblingChildAModule);
  const childBApp = assignModule(GuardSiblingChildBModule);

  [baseApp, childAApp, childBApp].forEach((app) => app.onError(errorHandler()));

  const baseResponse = await baseApp.request('/base-path');
  assertEquals(baseResponse.status, 200);

  // Child A inherits AllowGuard from the base AND adds its own DenyGuard — denied.
  const childAResponse = await childAApp.request('/child-a-path');
  assertEquals(childAResponse.status, 403);

  // Child B only inherits the base's AllowGuard, never sees child A's own DenyGuard — allowed.
  const childBResponse = await childBApp.request('/child-b-path');
  assertEquals(childBResponse.status, 200);
});
