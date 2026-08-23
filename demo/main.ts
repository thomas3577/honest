import { Hono } from 'hono';
// Demo-only dependency: not in deno.json's imports on purpose, so the
// published package carries zero trace of it — see the Scalar section in
// the README for why an inline npm: specifier here is enough.
// deno-lint-ignore no-import-prefix
import { Scalar } from 'npm:@scalar/hono-api-reference@0.11.16';
import { assignModule, buildOpenApiDocument, errorHandler } from '../mod.ts';

import { AppModule } from './app.module.ts';

const app = new Hono();
app.route('/', assignModule(AppModule));
app.onError(errorHandler());

const openApiDocument = buildOpenApiDocument(AppModule, {
  info: { title: 'Honest Demo', version: '0.1.0' },
});

app.get('/openapi.json', (c) => c.json(openApiDocument));
app.get('/reference', Scalar({ url: '/openapi.json' }));

Deno.serve({ port: 8000 }, app.fetch);
