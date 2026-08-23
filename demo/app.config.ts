import { Config } from '../mod.ts';
import type { StandardSchema } from '../mod.ts';

type AppConfigShape = { greeting: string };

// A minimal, hand-rolled Standard Schema (same pattern as sample.controller.ts's
// CreateItemSchema) — in a real app, use Zod/Valibot/ArkType instead. Falls
// back to a default so `deno task demo` runs without any env setup.
const AppConfigSchema: StandardSchema<unknown, AppConfigShape> = {
  '~standard': {
    version: 1,
    vendor: 'honest-demo',
    validate: (value) => {
      const greeting = (value as Record<string, unknown> | undefined)?.GREETING;

      return { value: { greeting: typeof greeting === 'string' && greeting.length > 0 ? greeting : 'Hello from honest' } };
    },
  },
};

export class AppConfig extends Config(AppConfigSchema) {}
