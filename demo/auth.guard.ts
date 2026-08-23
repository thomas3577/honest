import type { Context } from 'hono';
import type { Guard } from '../mod.ts';

// A minimal demo guard — checks a static header instead of a real token.
export class AuthGuard implements Guard {
  canActivate(c: Context): boolean {
    return c.req.header('x-api-key') === 'demo-secret';
  }
}
