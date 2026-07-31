import type { Space, WorldObject } from './world-object.js';
import type { Timestamp } from '../value-objects/timestamp.js';

/**
 * What the turn reads of the world model.
 *
 * A projection, not the model. The world model is continuously mutable and
 * written by perception at 30–60 Hz; reasoning needs an immutable value taken
 * at one instant. Handing deliberation the live model would make the decision
 * depend on when it happened to look, which is the property `deliberate()`
 * exists to eliminate.
 *
 * This is also where the blackboard instinct legitimately lands. The world
 * model *is* blackboard-shaped — long-lived, mutable, written opportunistically
 * by independent sources. `CognitiveContext` is the snapshot taken of it. The
 * two are separated precisely so reasoning never runs over a substrate that
 * changes underneath it.
 */
export interface WorldSnapshot {
  /**
   * Objects the companion may refer to right now.
   *
   * Already filtered by the world capability against
   * `MIN_REFERENCEABLE_CONFIDENCE` and `OBSERVATION_FRESHNESS_MS`. Filtering
   * belongs there rather than here because the thresholds are the world
   * model's own policy, and a second filter downstream would let the two
   * disagree about what the companion is allowed to claim.
   */
  readonly objects: readonly WorldObject[];

  /** Where the user is believed to be, or null when unknown or unanchored. */
  readonly currentSpace: Space | null;

  /** When perception last updated the underlying model. */
  readonly observedAt: Timestamp;

  /**
   * True when nothing has been observed recently enough to be relied on.
   *
   * Carried rather than computed downstream, because `deliberate()` never reads
   * a clock — a staleness check performed during reasoning would be a time
   * dependency smuggled into a pure function. The world capability owns the
   * threshold and states the conclusion.
   */
  readonly stale: boolean;
}
