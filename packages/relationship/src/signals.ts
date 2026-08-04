import type {
  InteractionSignal,
  RelationshipCounters,
  RelationshipDimension,
  RelationshipDimensions,
} from '@nexa/models';
import { MAX_DIMENSION_DELTA_PER_INTERACTION } from '@nexa/models';
import { daysBetween } from './elapsed.js';

/** The per-dimension movement one interaction produces, before clamping. */
export type DimensionDeltas = Partial<Readonly<Record<RelationshipDimension, number>>>;

/**
 * What one interaction does to the dimensions.
 *
 * Expressed as fractions of `MAX_DIMENSION_DELTA_PER_INTERACTION` (0.02) so
 * that the ceiling is enforced in one place rather than reasoned about at every
 * rule. Nothing here can move an axis more than that cap, which is what makes
 * "relationships never change dramatically because of a single conversation"
 * structural rather than a matter of choosing small numbers carefully.
 *
 * At full rate, a dimension takes 50 interactions to cross its whole range. The
 * stage requirements then need that *and* elapsed days on top.
 */
const FULL = 1;
const HALF = 0.5;
const QUARTER = 0.25;

/**
 * Familiarity grows with every exchange; the rest are earned by what happened.
 *
 * Familiarity is the only dimension that rises unconditionally, because it is
 * the only one that genuinely means "we have interacted a lot" rather than a
 * judgement about how well it went.
 */
export const deltasFor = (signal: InteractionSignal): DimensionDeltas => {
  const deltas: Record<string, number> = {
    familiarity: FULL,
    // A small trust gain on every interaction, for simply having turned up and
    // behaved the same way again. `reliability` is one of identity's values,
    // and it is earned by consistency rather than by any single exchange going
    // well. Without this, a user who only ever makes small talk could never
    // pass `acquainted` however long they stayed — which would make the
    // interaction-count gate on every later stage unreachable and therefore
    // decorative.
    //
    // Deliberately a quarter rate: 20 interactions to move trust by 0.1, so it
    // never outruns the gains from actually being relied on.
    trust: QUARTER,
  };

  const add = (dimension: RelationshipDimension, amount: number): void => {
    deltas[dimension] = (deltas[dimension] ?? 0) + amount;
  };

  switch (signal.intent) {
    case 'request': {
      // Being asked to do something and doing it is what reliance is made of.
      add('reliance', FULL);
      add('trust', QUARTER);
      break;
    }
    case 'planning': {
      // Planning is deeper than a request: the user is admitting the companion
      // into something unfinished.
      add('reliance', FULL);
      add('trust', HALF);
      break;
    }
    case 'emotional_support': {
      // The strongest single trust signal available. Someone bringing a
      // difficulty has already decided the companion is safe to bring it to.
      add('trust', FULL);
      add('warmth', FULL);
      break;
    }
    case 'casual': {
      add('warmth', HALF);
      break;
    }
    case 'correction': {
      // A correction means the companion was wrong. Small and negative — being
      // correctable is healthy, and one mistake should cost far less than
      // sustained reliability earns.
      add('trust', -HALF);
      break;
    }
    case 'question':
    case 'statement':
    case 'unknown':
      break;
  }

  // Honesty is identity's highest-precedence value, so demonstrating it is
  // treated as trust-building — and deliberately outweighs the correction it
  // often accompanies. A companion that says "I do not know" and is then
  // corrected should end the exchange slightly ahead, not behind.
  if (signal.acknowledgedUncertainty) add('trust', FULL);
  if (signal.corrected) add('trust', -QUARTER);

  // Depth, not duration. A long exchange means the conversation went somewhere.
  if (signal.exchangeTurns >= 6) {
    add('familiarity', HALF);
    add('warmth', QUARTER);
  }

  return Object.fromEntries(
    Object.entries(deltas).map(([dimension, fraction]) => [
      dimension,
      fraction * MAX_DIMENSION_DELTA_PER_INTERACTION,
    ]),
  );
};

/**
 * Applies deltas, clamping each axis to 0–1 and to the per-interaction cap.
 *
 * The cap is re-applied here rather than trusted from `deltasFor`, because a
 * caller may supply its own deltas and the guarantee has to hold for them too.
 * It is the single promise this engine makes about rate of change, and a
 * promise enforced only at the call site that happens to be in the same package
 * is not enforced.
 */
export const applyDeltas = (
  dimensions: RelationshipDimensions,
  deltas: DimensionDeltas,
): RelationshipDimensions => {
  const next: Record<string, number> = { ...dimensions };

  for (const [dimension, raw] of Object.entries(deltas)) {
    if (raw === undefined) continue;
    const capped = Math.max(
      -MAX_DIMENSION_DELTA_PER_INTERACTION,
      Math.min(MAX_DIMENSION_DELTA_PER_INTERACTION, raw),
    );
    const current = next[dimension] ?? 0;
    next[dimension] = round(Math.max(0, Math.min(1, current + capped)));
  }

  return next as unknown as RelationshipDimensions;
};

/**
 * Familiarity fading over a long absence.
 *
 * Only familiarity decays. Trust and warmth are *earned*, and quietly revoking
 * them for silence would mean a companion greeted someone returning after a
 * year as though they had done something wrong. Familiarity is different: it
 * genuinely is a claim about how current the shared context is, and after a
 * year that claim is weaker.
 *
 * Deliberately slower than growth. A relationship should take longer to fade
 * than it took to build.
 */
export const DECAY_PER_DAY = 0.0015;

export const decayFamiliarity = (
  dimensions: RelationshipDimensions,
  lastInteractionAt: string,
  at: string,
  lapseAfterDays: number,
): RelationshipDimensions => {
  const idle = daysBetween(lastInteractionAt, at);
  if (idle <= lapseAfterDays) return dimensions;

  const decayed = (idle - lapseAfterDays) * DECAY_PER_DAY;
  return {
    ...dimensions,
    // Floored well above zero. However long the silence, the companion has
    // still met this person, and dropping to zero would make a returning user
    // a stranger — which is both false and unkind.
    familiarity: round(Math.max(0.1, dimensions.familiarity - decayed)),
  };
};

/** Counters after one interaction. */
export const countersAfter = (
  counters: RelationshipCounters,
  signal: InteractionSignal,
): RelationshipCounters => ({
  requestsHandled: counters.requestsHandled + (signal.intent === 'request' ? 1 : 0),
  plansSupported: counters.plansSupported + (signal.intent === 'planning' ? 1 : 0),
  correctionsReceived:
    counters.correctionsReceived +
    (signal.corrected || signal.intent === 'correction' ? 1 : 0),
  uncertaintiesAcknowledged:
    counters.uncertaintiesAcknowledged + (signal.acknowledgedUncertainty ? 1 : 0),
});

/**
 * Three decimals.
 *
 * Successive deltas of 0.02 accumulate floating-point error — after fifty
 * interactions a dimension lands on 0.9999999999999999 rather than 1, which
 * reads as a threshold not quite met and as a spurious difference between two
 * identical replays.
 */
const round = (value: number): number => Math.round(value * 1_000) / 1_000;
