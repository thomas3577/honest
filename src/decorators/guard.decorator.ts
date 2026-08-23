import '../utils/reflect-shim.ts';

import type { Context } from 'hono';
import { HttpError } from '../errors.ts';
import type { ClassConstructor, Next } from '../types.ts';
import { getRequestScope, registerMiddlewareClassDecorator, registerMiddlewareMethodDecorator } from '../utils/router.util.ts';

type MethodDecorator = <This, Args extends unknown[], Return>(
  value: (this: This, ...args: Args) => Return,
  context: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => Return>,
) => void;
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
 */
export function UseGuard<T extends ClassConstructor>(GuardClass: ClassConstructor<Guard>): ClassDecorator<T> & MethodDecorator {
  const handler = async (c: Context, next: Next) => {
    const requestScope = getRequestScope(c);

    if (!requestScope) {
      throw new Error('UseGuard() requires the controller to be mounted via assignModule() (no request scope found on this Context).');
    }

    const guard = requestScope.resolve(GuardClass);
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
  }) as ClassDecorator<T> & MethodDecorator;
}
