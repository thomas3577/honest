import { assertEquals, assertInstanceOf, assertThrows } from '@std/assert';

import { HttpError, ValidationError } from './errors.ts';

Deno.test('HttpError carries status, message, and optional details', () => {
  const error = new HttpError(404, 'Not found', { id: '42' });

  assertInstanceOf(error, Error);
  assertEquals(error.status, 404);
  assertEquals(error.message, 'Not found');
  assertEquals(error.details, { id: '42' });
  assertEquals(error.name, 'HttpError');
});

Deno.test('HttpError rejects statuses that cannot carry a response body', () => {
  assertThrows(() => new HttpError(204, 'Deleted'), RangeError);
  assertThrows(() => new HttpError(304, 'Not modified'), RangeError);
  assertThrows(() => new HttpError(101, 'Switching protocols'), RangeError);
});

Deno.test('HttpError rejects out-of-range or non-integer statuses', () => {
  assertThrows(() => new HttpError(4004, 'Typo'), RangeError);
  assertThrows(() => new HttpError(99, 'Too low'), RangeError);
  assertThrows(() => new HttpError(200.5, 'Not an integer'), RangeError);
});

Deno.test('ValidationError carries the schema issues', () => {
  const issues = [{ message: 'Required' }];
  const error = new ValidationError(issues);

  assertInstanceOf(error, Error);
  assertEquals(error.issues, issues);
  assertEquals(error.message, 'Validation failed');
  assertEquals(error.name, 'ValidationError');
});
