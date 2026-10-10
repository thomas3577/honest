import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { unstable_startWorker } from 'wrangler';

let worker;

before(async () => {
  worker = await unstable_startWorker({ config: fileURLToPath(new URL('./wrangler.jsonc', import.meta.url)) });
  await worker.ready;
});

after(async () => {
  await worker?.dispose();
});

test('a Honest app runs as a Cloudflare Worker and resolves config from the bindings', async () => {
  const response = await worker.fetch('http://example.com/hello');

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { greeting: 'hello from workerd' });
});

test('ip() reads cf-connecting-ip on Workers', async () => {
  const response = await worker.fetch('http://example.com/hello/ip', { headers: { 'cf-connecting-ip': '198.51.100.7' } });

  assert.deepEqual(await response.json(), { ip: '198.51.100.7' });
});
