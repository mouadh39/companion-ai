/**
 * Structural helpers used across the domain.
 *
 * Kept small on purpose. A utility-type collection is the same trap as a
 * `utils` package: it accretes clever types nobody can read, and every one of
 * them becomes a coupling point. Each entry here earns its place by being used
 * by more than one entity.
 */

/**
 * A value that may legitimately be absent.
 *
 * `null` rather than `undefined`, because `undefined` does not survive a JSON
 * round trip: `{ a: undefined }` serialises to `{}`, and a field that silently
 * disappears through the event log is indistinguishable from one that was never
 * written. The repo's `exactOptionalPropertyTypes` setting makes the difference
 * between "absent" and "present and null" a compile-time distinction, and this
 * type is how the domain says it means the second one.
 */
export type Nullable<T> = T | null;

/** Recursively immutable. Applied at aggregate boundaries that must not be mutated in place. */
export type DeepReadonly<T> = T extends (infer TItem)[]
  ? readonly DeepReadonly<TItem>[]
  : T extends readonly (infer TItem)[]
    ? readonly DeepReadonly<TItem>[]
    : T extends object
      ? { readonly [TKey in keyof T]: DeepReadonly<T[TKey]> }
      : T;

/**
 * Extracts the member of a discriminated union whose `type` is `TType`.
 *
 * Used by every union in the domain — actions, events, tools — so that a
 * handler can name the exact shape it accepts instead of re-deriving the
 * narrowing at each call site.
 */
export type MemberOfType<TUnion extends { readonly type: string }, TType extends TUnion['type']> =
  Extract<TUnion, { readonly type: TType }>;

/**
 * Exhaustiveness guard for `switch` over a discriminated union.
 *
 * Placed in the `default` branch, it turns "someone added a variant and forgot
 * a case" from a runtime surprise into a compile error. The runtime throw is
 * reachable only when untyped data crosses a boundary — which is precisely when
 * failing loudly beats continuing with a value nothing understands.
 */
export const assertNever = (value: never, context = 'value'): never => {
  throw new TypeError(`Unhandled ${context}: ${JSON.stringify(value)}`);
};
