import type { CompanionId, WorldObjectId } from '@nexa/shared';
import type { ObservationState, SpaceType, WorldObjectType } from '../enums/world.js';
import type { ConfidenceScore } from '../value-objects/score.js';
import type { SpatialPosition } from '../value-objects/coordinate.js';
import type { Timestamp } from '../value-objects/timestamp.js';
import type { Metadata } from '../value-objects/metadata.js';

/**
 * Something the companion believes is in the user's space.
 *
 * A belief, not a measurement. `03_Companion_Core.md` draws the line precisely:
 * the client observes the world, the core understands it. So this carries a
 * `confidence` and an `observationState` — the companion must be able to say
 * "I think your keys are on the desk" and be wrong, rather than asserting the
 * contents of a tracking buffer as fact.
 *
 * `position` is nullable because knowing a thing exists and knowing where it is
 * are separate. A companion that has been told about a coffee machine it has
 * never seen still knows about the coffee machine.
 */
export interface WorldObject {
  readonly id: WorldObjectId;
  /**
   * Scoped to a companion, not a user.
   *
   * Two companions belonging to the same person may occupy different rooms and
   * hold different, both-correct beliefs about where things are.
   */
  readonly companionId: CompanionId;
  readonly type: WorldObjectType;
  /** What the user would call it — "the desk", "your keys". Enters the prompt. */
  readonly label: string;
  /** Null when the object is known but unlocated. */
  readonly position: SpatialPosition | null;
  /** How sure the companion is that this exists and is what it thinks it is. */
  readonly confidence: ConfidenceScore;
  readonly observationState: ObservationState;
  readonly firstSeenAt: Timestamp;
  /**
   * When it was last directly observed.
   *
   * Drives the decay from `observed` through `stale`. The gap between this and
   * now is the difference between a helpful reference and a confident lie.
   */
  readonly lastSeenAt: Timestamp;
  /** The space it belongs to, or null when unassigned. */
  readonly spaceId: WorldObjectId | null;
  readonly metadata: Metadata;
}

/**
 * A named region the user thinks of as a place.
 *
 * Separate from `WorldObject` because a space is not an object within one.
 * `30_Location_and_Spaces.md` makes these the anchors for location-scoped
 * memory — "we talked about this in the kitchen" needs the kitchen to be
 * nameable.
 */
export interface Space {
  readonly id: WorldObjectId;
  readonly companionId: CompanionId;
  readonly type: SpaceType;
  readonly label: string;
  /**
   * The AR anchor this space is pinned to, or null when unanchored.
   *
   * Anchor-relative positions survive relocalisation; session-relative ones do
   * not. A space persisted without an anchor is one the companion will not find
   * again after the user leaves the room.
   */
  readonly anchorId: string | null;
  readonly lastVisitedAt: Timestamp;
}

/**
 * How long an object stays `observed` before decaying to `stale`, in ms.
 *
 * Fifteen minutes. Long enough that glancing away does not make the companion
 * forget the table; short enough that it stops asserting the position of a
 * coffee cup someone has since carried off.
 */
export const OBSERVATION_FRESHNESS_MS = 15 * 60 * 1000;

/** Minimum confidence before the companion may refer to an object unprompted. */
export const MIN_REFERENCEABLE_CONFIDENCE = 0.7;
