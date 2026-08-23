import { ValidationError } from '../errors.ts';
import type { InferOutput, StandardSchema } from '../standard-schema.ts';

/**
 * Returns a base class that validates a config source — by default
 * `Deno.env.toObject()` — against a Standard Schema (Zod, Valibot, ArkType, ...)
 * once, synchronously, in its constructor, and exposes the validated,
 * typed result as `.value`. Extend it, don't decorate with it — TypeScript
 * can't propagate a decorator's return type to the decorated class's own
 * type (so `.value` would need a cast at every call site), but a normal
 * `extends` is fully typed with no cast required:
 *
 * ```ts
 * const AppConfigSchema = z.object({ PORT: z.coerce.number(), DATABASE_URL: z.string().url() });
 *
 * export class AppConfig extends Config(AppConfigSchema) {}
 *
 * // providers: [AppConfig] in @Module(), then:
 * constructor(private config = inject(AppConfig)) {}
 * // this.config.value.DATABASE_URL — typed, validated, no cast
 * ```
 *
 * Deliberately synchronous only: Standard Schema allows an async
 * `validate()`, but an env-var schema never needs one, and supporting it
 * would mean `.value` isn't guaranteed to be ready the moment `AppConfig`
 * is injected anywhere. For genuinely async startup work, implement
 * `OnModuleInit` instead — see `initModule()` in `utils/router.util.ts`.
 *
 * Validation failure throws `ValidationError` immediately, the same as any
 * other constructor error `assignModule()` would let escape — it's a
 * startup failure, not a request, so it does not go through `errorHandler()`.
 */
export function Config<TSchema extends StandardSchema>(
  schema: TSchema,
  source: () => Record<string, unknown> = () => Deno.env.toObject(),
): new () => { readonly value: InferOutput<TSchema> } {
  return class {
    readonly value: InferOutput<TSchema>;

    constructor() {
      const result = schema['~standard'].validate(source());

      if (result instanceof Promise) {
        // We intentionally never use this result, but it's still a live
        // promise — if it later rejects with nothing attached to it, that
        // becomes an unhandled rejection (and can crash the process) on
        // top of the synchronous error thrown below.
        result.catch(() => {});
        throw new Error('Config() requires a schema that validates synchronously; async validation is not supported.');
      }

      if (result.issues) {
        throw new ValidationError(result.issues);
      }

      this.value = result.value as InferOutput<TSchema>;
    }
  };
}
