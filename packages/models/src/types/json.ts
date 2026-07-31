/**
 * The JSON value lattice.
 *
 * Every domain object in Nexa is persisted, put on a wire, written to an
 * append-only event log, and replayed years later. `JsonValue` is how that
 * requirement is stated in the type system rather than in a comment: a field
 * typed with it cannot hold a `Date`, a `Map`, a class instance, or a function,
 * all of which serialise to something lossy and deserialise to something else.
 *
 * This is also the reason the codebase has no `any`. `any` disables the check
 * exactly where it matters most — at the storage and transport boundary.
 */
export type JsonPrimitive = string | number | boolean | null;

export interface JsonObject {
  readonly [key: string]: JsonValue;
}

export type JsonArray = readonly JsonValue[];

export type JsonValue = JsonPrimitive | JsonObject | JsonArray;

/**
 * Narrows `unknown` to `JsonPrimitive`.
 *
 * Boundary code — parsing a model response, reading a column, accepting a
 * request body — receives `unknown` and must prove what it has. This is the
 * proof, and it is deliberately shallow: recursive validation of a whole
 * document belongs to a schema validator, not to the domain vocabulary.
 */
export const isJsonPrimitive = (value: unknown): value is JsonPrimitive =>
  value === null ||
  typeof value === 'string' ||
  typeof value === 'number' ||
  typeof value === 'boolean';
