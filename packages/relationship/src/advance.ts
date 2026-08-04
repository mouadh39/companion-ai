import type {
  InteractionSignal,
  Relationship,
  RelationshipReason,
  RelationshipType,
  RelationshipUpdate,
  StageChange,
} from '@nexa/models';
import { RELATIONSHIP_RANK } from '@nexa/models';
import { applyDeltas, countersAfter, decayFamiliarity, deltasFor } from './signals.js';
import { LAPSE_AFTER_DAYS, hasLapsed, stageFor } from './stages.js';

/**
 * Applies one interaction and returns the relationship that follows.
 *
 * Pure: the same record and the same signal always produce the same result, and
 * nothing here reads a clock — `signal.at` is the only source of time. That is
 * what makes a relationship **replayable**. Re-running a user's whole history
 * of signals from the beginning reconstructs the current relationship exactly,
 * which is the only way to answer "how did we get here?" without having stored
 * every intermediate state.
 *
 * The order is deliberate and each step depends on the last:
 *
 * 1. **Decay** for time already elapsed, against the *old* last-contact time.
 * 2. **Apply** this interaction's deltas, each capped.
 * 3. **Recompute** the stage from the resulting numbers.
 *
 * Decaying after applying would let an interaction be eroded by the silence
 * that preceded it, which would mean returning after a long gap made things
 * worse rather than better.
 */
export const advance = (
  relationship: Relationship,
  signal: InteractionSignal,
): RelationshipUpdate => {
  const reasons: RelationshipReason[] = [];

  // 1 — decay, against the gap that has already happened.
  const lapsed = hasLapsed(relationship, signal.at);
  if (lapsed) {
    reasons.push({
      code: 'contact_lapsed',
      detail: 'Contact had lapsed; familiarity faded before this interaction.',
    });
  }
  const decayed = decayFamiliarity(
    relationship.dimensions,
    relationship.lastInteractionAt,
    signal.at,
    LAPSE_AFTER_DAYS,
  );

  // 2 — apply this interaction.
  const dimensions = applyDeltas(decayed, deltasFor(signal));
  const counters = countersAfter(relationship.counters, signal);

  const moved: Relationship = {
    ...relationship,
    dimensions,
    counters,
    interactionCount: relationship.interactionCount + 1,
    lastInteractionAt: signal.at,
  };

  // 3 — recompute the stage from what the numbers now support.
  const stage = stageFor(moved, signal.at);
  const stageChange = changeBetween(relationship.type, stage);

  if (stageChange !== null) {
    reasons.push({
      code:
        stageChange.direction === 'advanced'
          ? 'stage_requirements_met'
          : 'stage_requirements_unmet',
      detail: `Stage ${stageChange.direction}: '${stageChange.from}' → '${stageChange.to}'.`,
    });
  }

  if (signal.acknowledgedUncertainty) {
    reasons.push({
      code: 'sustained_interaction',
      detail: 'Companion acknowledged uncertainty; trust credited for honesty.',
    });
  }

  return {
    relationship: { ...moved, type: stage },
    stageChange,
    reasons,
  };
};

/**
 * The stage transition, or null when nothing moved.
 *
 * Regression is reported as an ordinary outcome rather than suppressed. A
 * relationship that can only advance is a counter, not a relationship, and a
 * companion whose stage silently never falls will keep behaving as though it is
 * close to someone who stopped talking to it a year ago.
 */
const changeBetween = (
  from: RelationshipType,
  to: RelationshipType,
): StageChange | null => {
  if (from === to) return null;
  return {
    from,
    to,
    direction: RELATIONSHIP_RANK[to] > RELATIONSHIP_RANK[from] ? 'advanced' : 'regressed',
  };
};

/**
 * Replays a whole history from a starting record.
 *
 * The function that makes the replay claim testable rather than aspirational.
 * Signals are applied in order, and because each is pure the result depends
 * only on the sequence — not on when the replay runs.
 */
export const replay = (
  from: Relationship,
  signals: readonly InteractionSignal[],
): Relationship =>
  signals.reduce((current, signal) => advance(current, signal).relationship, from);
