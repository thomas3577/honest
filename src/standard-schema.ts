/**
 * A minimal subset of the Standard Schema v1 interface (https://standardschema.dev),
 * implemented by Zod (>=3.24), Valibot, and ArkType. Kept local on purpose —
 * this file has no runtime code, only types, so depending on it adds no
 * runtime dependency to honest.
 */
export interface StandardSchema<Input = unknown, Output = Input> {
  readonly '~standard': StandardSchemaProps<Input, Output>;
}

export interface StandardSchemaProps<Input = unknown, Output = Input> {
  readonly version: 1;
  readonly vendor: string;
  readonly validate: (value: unknown) => StandardSchemaResult<Output> | Promise<StandardSchemaResult<Output>>;
}

export type StandardSchemaResult<Output> = StandardSchemaSuccessResult<Output> | StandardSchemaFailureResult;

export interface StandardSchemaSuccessResult<Output> {
  readonly value: Output;
  readonly issues?: undefined;
}

export interface StandardSchemaFailureResult {
  readonly issues: readonly StandardSchemaIssue[];
}

export interface StandardSchemaIssue {
  readonly message: string;
  readonly path?: ReadonlyArray<PropertyKey | { readonly key: PropertyKey }>;
}

export type InferOutput<TSchema extends StandardSchema> = TSchema extends StandardSchema<unknown, infer Output> ? Output : never;
