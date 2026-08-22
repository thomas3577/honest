import { Hono } from 'hono';
import { assignModule, errorHandler } from '../mod.ts';

import { AppModule } from './app.module.ts';

const app = new Hono();
app.route('/', assignModule(AppModule));
app.onError(errorHandler());

Deno.serve({ port: 8000 }, app.fetch);
