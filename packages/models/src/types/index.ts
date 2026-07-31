/**
 * Type-level utilities used across the domain.
 *
 * Everything here is erased at compile time except `assertNever`, which is the
 * one runtime guard the domain needs: it converts "someone added a union member
 * and forgot a case" from a silent fallthrough into a compile error.
 */
export type { JsonValue, JsonPrimitive, JsonObject, JsonArray } from './json.js';
export { isJsonPrimitive } from './json.js';

export type { Brand } from './brand.js';

export type { Nullable, DeepReadonly, MemberOfType } from './utility.js';
export { assertNever } from './utility.js';
