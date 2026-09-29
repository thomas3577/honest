import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import * as log from '@std/log';

import { HttpError, ValidationError } from '../errors.ts';
import type { StandardSchemaIssue } from '../standard-schema.ts';

/**
 * Reduces an issue to `message` and a plain-key `path`. Schema libraries
 * attach more (Valibot: `input`, and path segments carrying `input`/`value`),
 * which would echo the request — including secrets — back in the response.
 */
const toPublicIssue = ({ message, path }: StandardSchemaIssue) => path ? { message, path: path.map((segment) => typeof segment === 'object' ? segment.key : segment) } : { message };

/** Signature of a Hono `app.onError()` handler. */
export type ErrorHandler = (err: Error, c: Context) => Response;

/**
 * A ready-made `app.onError()` handler: maps `ValidationError` to 400 with
 * the schema's issues (`message` and `path` only), `HttpError` to its own status/details, and anything
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
      return c.json({ error: 'Validation failed', issues: err.issues.map(toPublicIssue) }, 400);
    }

    if (err instanceof HttpError) {
      return c.json({ error: err.message, details: err.details }, err.status as ContentfulStatusCode);
    }

    log.error(err);

    return c.json({ error: 'Internal Server Error' }, 500);
  };
}
