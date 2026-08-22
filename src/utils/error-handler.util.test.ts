import { assertEquals } from '@std/assert';
import { Hono } from 'hono';

import { HttpError, ValidationError } from '../errors.ts';
import { errorHandler } from './error-handler.util.ts';

Deno.test('errorHandler() maps ValidationError to 400 with issues', async () => {
  const app = new Hono();

  app.get('/', () => {
    throw new ValidationError([{ message: 'Required' }]);
  });
  app.onError(errorHandler());

  const response = await app.request('/');

  assertEquals(response.status, 400);
  assertEquals(await response.json(), { error: 'Validation failed', issues: [{ message: 'Required' }] });
});

Deno.test('errorHandler() maps HttpError to its own status and details', async () => {
  const app = new Hono();

  app.get('/', () => {
    throw new HttpError(404, 'Not found', { id: '42' });
  });
  app.onError(errorHandler());

  const response = await app.request('/');

  assertEquals(response.status, 404);
  assertEquals(await response.json(), { error: 'Not found', details: { id: '42' } });
});

Deno.test('errorHandler() maps unknown errors to a generic 500', async () => {
  const app = new Hono();

  app.get('/', () => {
    throw new Error('boom');
  });
  app.onError(errorHandler());

  const response = await app.request('/');

  assertEquals(response.status, 500);
  assertEquals(await response.json(), { error: 'Internal Server Error' });
});
