import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Hono } from 'hono';

import { HttpError, ValidationError } from '../errors.ts';
import { errorHandler } from './error-handler.util.ts';

test('errorHandler() maps ValidationError to 400 with issues', async () => {
  const app = new Hono();

  app.get('/', () => {
    throw new ValidationError([{ message: 'Required' }]);
  });
  app.onError(errorHandler());

  const response = await app.request('/');

  assert.deepEqual(response.status, 400);
  assert.deepEqual(await response.json(), { error: 'Validation failed', issues: [{ message: 'Required' }] });
});

test('errorHandler() renders only message and a plain-key path, never the issue input', async () => {
  const app = new Hono();

  app.get('/', () => {
    // Valibot-shaped issue: `input` on the issue and on each path segment.
    const issue = { message: 'Invalid length', input: 'hunter2', path: [{ type: 'object', input: { password: 'hunter2' }, key: 'password', value: 'hunter2' }, 0] };

    throw new ValidationError([issue]);
  });
  app.onError(errorHandler());

  const response = await app.request('/');

  assert.deepEqual(response.status, 400);
  assert.deepEqual(await response.json(), { error: 'Validation failed', issues: [{ message: 'Invalid length', path: ['password', 0] }] });
});

test('errorHandler() maps HttpError to its own status and details', async () => {
  const app = new Hono();

  app.get('/', () => {
    throw new HttpError(404, 'Not found', { id: '42' });
  });
  app.onError(errorHandler());

  const response = await app.request('/');

  assert.deepEqual(response.status, 404);
  assert.deepEqual(await response.json(), { error: 'Not found', details: { id: '42' } });
});

test('errorHandler() maps unknown errors to a generic 500', async () => {
  const app = new Hono();

  app.get('/', () => {
    throw new Error('boom');
  });
  app.onError(errorHandler());

  const response = await app.request('/');

  assert.deepEqual(response.status, 500);
  assert.deepEqual(await response.json(), { error: 'Internal Server Error' });
});

test('errorHandler() runs after error middleware that calls next(), and gets non-Error throws wrapped by Hono', async () => {
  const app = new Hono();
  const seen: unknown[] = [];

  app.get('/', () => {
    throw 'boom';
  });
  app.onError(async (c, next) => {
    seen.push(c.error);
    await next();
  });
  app.onError(errorHandler());

  const response = await app.request('/');

  assert.deepEqual(response.status, 500);
  assert.deepEqual(await response.json(), { error: 'Internal Server Error' });
  assert.ok(seen[0] instanceof Error);
  assert.deepEqual(seen[0].message, 'boom');
  assert.deepEqual(seen[0].cause, 'boom');
});
