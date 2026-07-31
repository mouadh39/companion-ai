import type { UserId } from '@nexa/shared';
import type { Timestamp } from '../value-objects/timestamp.js';

/**
 * Structural contracts the entities satisfy.
 *
 * These are *shapes*, not repositories or services. A generic mechanism —
 * an audit writer, a retention sweep, a cache — needs to say "anything with an
 * id and a creation time" without naming fourteen types or widening to
 * `unknown`. That is all these are for.
 *
 * They are intentionally not base interfaces that entities `extends`. Nexa
 * composes rather than inherits: an entity satisfies a contract by having the
 * right fields, and a contract can be applied to a type that was written
 * without knowing it existed.
 */

/** Anything with a stable identity. */
export interface Entity<TId extends string> {
  readonly id: TId;
}

/** Anything that records when it came into being. */
export interface Created {
  readonly createdAt: Timestamp;
}

/** Anything that records when it last changed. */
export interface Updated {
  readonly updatedAt: Timestamp;
}

/**
 * Anything scoped to a user.
 *
 * The type-level statement of the privacy model. Every user-owned record is
 * reachable only through its owner, and a generic query helper constrained to
 * this cannot be handed a type that has no owner — which is where cross-tenant
 * leaks come from.
 */
export interface UserOwned {
  readonly userId: UserId;
}

/**
 * Anything whose schema is versioned.
 *
 * Applies to what is persisted and replayed. `06_Event_System.md` allows only
 * additive change; the version is what lets a reader know which shape it holds.
 */
export interface Versioned {
  readonly version: number;
}

/**
 * Anything carrying a confidence the companion should be able to justify.
 *
 * Grouping these makes a rule expressible in one place: nothing below the
 * actionable threshold is asserted to the user. Without the contract, that
 * check is re-implemented per type and drifts.
 */
export interface Uncertain {
  readonly confidence: number;
}
