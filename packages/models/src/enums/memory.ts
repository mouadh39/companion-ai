/**
 * The specialised memory systems. Nexa does not have "a" memory.
 *
 * - `episodic`   — what happened, and when
 * - `semantic`   — what is true, independent of time
 * - `procedural` — how something is done
 * - `relational` — what the relationship is like
 * - `reflective` — an insight derived from other memories, not observed directly
 *
 * The split is not taxonomy for its own sake: each type is retrieved by
 * different signals. Episodic memory is recency-weighted, semantic memory is
 * not, and ranking them with one formula makes both worse. See
 * `docs/memory/18_Memory_Architecture.md`.
 */
export type MemoryType =
  | 'episodic'
  | 'semantic'
  | 'procedural'
  | 'relational'
  | 'reflective';

/**
 * The runtime companion to `MemoryType`.
 *
 * `satisfies` is what keeps the two in step: adding a member to the union
 * without adding it here is a compile error, so the list cannot silently rot.
 * This is the pattern used for every enum in the package, and it is why the
 * codebase has no TypeScript `enum` — the union is erased at build time, works
 * with `isolatedModules`, and still yields an iterable list where one is needed.
 */
export const MEMORY_TYPES = [
  'episodic',
  'semantic',
  'procedural',
  'relational',
  'reflective',
] as const satisfies readonly MemoryType[];

/**
 * Where a memory came from.
 *
 * Provenance is not metadata here — it is what lets the companion say "you told
 * me" rather than "I concluded", and it is the first thing to check when a
 * memory turns out to be wrong. `user_stated` outranks `reflection` when two
 * memories conflict.
 */
export type MemorySource = 'conversation' | 'observation' | 'reflection' | 'user_stated';

export const MEMORY_SOURCES = [
  'conversation',
  'observation',
  'reflection',
  'user_stated',
] as const satisfies readonly MemorySource[];

/**
 * How a memory leaves active circulation.
 *
 * Forgetting is a required capability, and it is not deletion. `superseded`
 * and `merged` keep the original readable so history stays intact; only
 * `user_deleted` is meant to actually remove it, because
 * `18_Memory_Architecture.md` makes the memory the user's property.
 */
export type ForgetReason = 'decayed' | 'superseded' | 'merged' | 'user_deleted' | 'expired';

export const FORGET_REASONS = [
  'decayed',
  'superseded',
  'merged',
  'user_deleted',
  'expired',
] as const satisfies readonly ForgetReason[];
