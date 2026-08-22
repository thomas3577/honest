import type { StandardSchemaIssue } from './standard-schema.ts';

/**
 * Statuses that must not carry a response body (per the Fetch spec /
 * `hono/utils/http-status`'s `ContentlessStatusCode`). `HttpError` always
 * renders a JSON body (`{ error, details }`), so these are rejected at
 * construction time rather than crashing later inside `errorHandler()`.
 */
const CONTENTLESS_STATUS_CODES = new Set([101, 204, 205, 304]);

/**
 * An error that maps directly onto an HTTP response when thrown from a
 * handler or middleware and caught by `errorHandler()`
 * (see utils/error-handler.util.ts).
 */
export class HttpError extends Error {
  readonly status: number;
  readonly details?: unknown;

  constructor(status: number, message: string, details?: unknown) {
    if (!Number.isInteger(status) || status < 100 || status > 599) {
      throw new RangeError(`HttpError status must be an integer between 100 and 599, got ${status}.`);
    }

    if (CONTENTLESS_STATUS_CODES.has(status)) {
      throw new RangeError(`HttpError status ${status} cannot carry a response body (message/details) — that status is not allowed to have one.`);
    }

    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.details = details;
  }
}

/**
 * Thrown by `validatedBody()`/`validatedQuery()`/`validatedParam()` when a
 * Standard Schema validation fails. Caught by `errorHandler()` and mapped
 * to a 400 response carrying the schema's issues.
 */
export class ValidationError extends Error {
  constructor(readonly issues: readonly StandardSchemaIssue[]) {
    super('Validation failed');
    this.name = 'ValidationError';
  }
}
