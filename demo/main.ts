import { Hono } from 'hono';
import { assignModule } from '../mod.ts';

import { AppModule } from './app.module.ts';

const app = new Hono();
app.route('/', assignModule(AppModule));

Deno.serve({ port: 8000 }, app.fetch);
