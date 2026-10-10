import assert from 'node:assert/strict';
import { test } from 'node:test';

import { HttpError, ValidationError } from './errors.ts';

test('HttpError carries status, message, and optional details', () => {
  const error = new HttpError(404, 'Not found', { id: '42' });

  assert.ok(error instanceof Error);
  assert.deepEqual(error.status, 404);
  assert.deepEqual(error.message, 'Not found');
  assert.deepEqual(error.details, { id: '42' });
  assert.deepEqual(error.name, 'HttpError');
});

test('HttpError rejects statuses that cannot carry a response body', () => {
  assert.throws(() => new HttpError(204, 'Deleted'), RangeError);
  assert.throws(() => new HttpError(304, 'Not modified'), RangeError);
  assert.throws(() => new HttpError(101, 'Switching protocols'), RangeError);
});

test('HttpError rejects out-of-range or non-integer statuses', () => {
  assert.throws(() => new HttpError(4004, 'Typo'), RangeError);
  assert.throws(() => new HttpError(99, 'Too low'), RangeError);
  assert.throws(() => new HttpError(200.5, 'Not an integer'), RangeError);
});

test('ValidationError carries the schema issues', () => {
  const issues = [{ message: 'Required' }];
  const error = new ValidationError(issues);

  assert.ok(error instanceof Error);
  assert.deepEqual(error.issues, issues);
  assert.deepEqual(error.message, 'Validation failed');
  assert.deepEqual(error.name, 'ValidationError');
});
