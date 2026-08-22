import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import * as log from '@std/log';

import { HttpError, ValidationError } from '../errors.ts';

export type ErrorHandler = (err: Error, c: Context) => Response;

/**
 * A ready-made `app.onError()` handler: maps `ValidationError` to 400 with
 * the schema's issues, `HttpError` to its own status/details, and anything
 * else to a logged, generic 500 — instead of relying on Hono's bare default
 * error response or hand-rolled per-project `onError` code.
 *
 * @example
 * ```typescript
 * app.onError(errorHandler());
 * ```
 */
export function errorHandler(): ErrorHandler {
  return (err, c) => {
    if (err instanceof ValidationError) {
      return c.json({ error: 'Validation failed', issues: err.issues }, 400);
    }

    if (err instanceof HttpError) {
      return c.json({ error: err.message, details: err.details }, err.status as ContentfulStatusCode);
    }

    log.error(err);

    return c.json({ error: 'Internal Server Error' }, 500);
  };
}
