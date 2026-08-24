import '../utils/reflect-shim.ts';

import type { Context } from 'hono';
import { HttpError } from '../errors.ts';
import type { ClassConstructor, MethodDecoratorFn, Next } from '../types.ts';
import { registerMiddlewareClassDecorator, registerMiddlewareMethodDecorator, requireRequestScope } from '../utils/router.util.ts';

type ClassDecorator<T extends ClassConstructor> = (target: T, context: ClassDecoratorContext<T>) => void;

/**
 * Implement to gate access to a route — or, with a class-level `@UseGuard()`,
 * every route on a controller. Return (or resolve to) `false` to deny the
 * request with a plain `403`; throw your own `HttpError` instead for a
 * different status or message.
 */
export interface Guard {
  canActivate(c: Context): boolean | Promise<boolean>;
}

/**
 * Gates a route, or — applied to the controller class itself — every route
 * on it, behind `GuardClass.canActivate(c)`. The guard is resolved through
 * the request scope (the same mechanism `scoped()` uses), so it can
 * `inject()` any of the module's singleton providers; like `scoped()`, it
 * requires the controller to be mounted via `assignModule()`.
 *
 * ```ts
 * class AuthGuard implements Guard {
 *   constructor(private readonly auth = inject(AuthService)) {}
 *
 *   canActivate(c: Context) {
 *     return this.auth.isValid(c.req.header('authorization'));
 *   }
 * }
 *
 * @UseGuard(AuthGuard) // every route on this controller
 * @Controller('admin')
 * export class AdminController {
 *   @UseGuard(SomeOtherGuard) // stacks with the class-level guard above
 *   @Get('audit-log')
 *   auditLog() {
 *     // ...
 *   }
 * }
 * ```
 *
 * Guards are additive across inheritance, never subtractive: a subclass
 * that extends a guarded controller/method inherits its guard(s) on top of
 * any it applies itself — there is no way to remove or replace an inherited
 * guard, only add more. This matches how a class-level guard and a
 * method-level guard already stack on the same route (either one denying
 * is enough to deny); overriding a method to drop its base guard requires
 * giving the override a different name instead.
 */
export function UseGuard<T extends ClassConstructor>(GuardClass: ClassConstructor<Guard>): ClassDecorator<T> & MethodDecoratorFn {
  const handler = async (c: Context, next: Next) => {
    const guard = requireRequestScope(c, 'UseGuard()').resolve(GuardClass);
    const allowed = await guard.canActivate(c);

    if (!allowed) {
      throw new HttpError(403, 'Forbidden');
    }

    await next();
  };

  return ((target: unknown, context: ClassDecoratorContext | ClassMethodDecoratorContext) => {
    if (context.kind === 'class') {
      registerMiddlewareClassDecorator(target as ClassConstructor, handler);

      return;
    }

    registerMiddlewareMethodDecorator(context as ClassMethodDecoratorContext, handler);
  }) as ClassDecorator<T> & MethodDecoratorFn;
}
