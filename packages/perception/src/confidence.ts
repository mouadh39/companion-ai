import type {
  ObservationDimension,
  ObservationEvidence,
  ObservationStance,
} from '@nexa/models';
import { ceilingFor } from './dimensions.js';

/**
 * How sure to be about one observation, from that observation's evidence alone.
 *
 * ## The signature is the guarantee
 *
 * This function takes a dimension, a stance and *its own* evidence. It cannot
 * see other observations, because it is never given them. That is not a
 * convention to be respected — it is the only thing in the engine that could
 * borrow confidence, and it has been built unable to.
 *
 * The rule it enforces: **no observation may raise or lower another's
 * confidence.** Not a corroborating phrase two sentences later that produced its
 * own observation, not a concurring reading from the voice channel, not a
 * standing insight that this user is often frustrated. Two channels that agree
 * yield two observations, each at its own confidence, and what to make of the
 * agreement belongs to whoever is deciding — not to whoever is noticing.
 *
 * The failure this prevents is specific and easy to write by accident: three
 * hedged hints, each worth 0.4 alone, quietly combining into one 0.85 claim that
 * someone is upset. Every step of that looks reasonable. The result is a
 * companion confidently wrong about a person's inner life.
 *
 * ## What *does* raise confidence
 *
 * More evidence for the same observation — several markers of the same
 * frustration in one message. That is not borrowing; it is the same reading
 * resting on more of the same utterance. It is bounded hard: additional cues are
 * worth a fixed small increment each, and the strongest single cue still carries
 * the result.
 */

/**
 * What each additional cue adds.
 *
 * Small, flat, and capped below. Making it proportional would let a message that
 * repeats one complaint six times read as near-certainty — turning emphasis into
 * evidence, which is exactly what a person doing the repeating would not mean.
 */
export const BONUS_PER_EXTRA_CUE = 0.05;

/** The most all the extra cues together may add, however many there are. */
export const MAX_CORROBORATION_BONUS = 0.15;

export interface Scored {
  readonly confidence: number;
  readonly ceiling: number;
  /** True when the ceiling, rather than the evidence, decided the number. */
  readonly capped: boolean;
}

/**
 * Scores one observation.
 *
 * The strongest cue sets the level and the rest nudge it, rather than any form
 * of averaging. Averaging is wrong here in a way worth stating: a message
 * containing "I am exhausted" *and* a passing use of the word "tired" would
 * average down to less certainty than the self-report alone justified. Weak
 * corroboration should never weaken.
 */
export const score = (
  dimension: ObservationDimension,
  stance: ObservationStance,
  evidence: readonly ObservationEvidence[],
): Scored => {
  const ceiling = ceilingFor(dimension, stance);

  if (evidence.length === 0) return { confidence: 0, ceiling, capped: false };

  let strongest = 0;
  for (const cue of evidence) if (cue.strength > strongest) strongest = cue.strength;

  const bonus = Math.min(
    MAX_CORROBORATION_BONUS,
    BONUS_PER_EXTRA_CUE * (evidence.length - 1),
  );

  const raw = strongest + bonus;
  return {
    confidence: round(Math.min(ceiling, raw)),
    ceiling,
    capped: raw > ceiling,
  };
};

/**
 * How much of the thing was present, 0–1.
 *
 * Separate from confidence and computed separately, because they answer
 * different questions and come apart constantly. A single hedged phrase is weak
 * evidence — low confidence — that the frustration is considerable — high
 * magnitude. Collapsing them would report mild frustration, which is a third
 * claim that nothing in the message supports.
 *
 * Magnitude is supplied by the extractor that measured it, since only the
 * extractor knows what "a lot" means for its dimension: for verbosity it is
 * message length, for urgency it is how insistent the phrasing is. This clamps
 * and rounds, and deliberately applies no ceiling — a ceiling on magnitude would
 * be the engine deciding someone cannot be very frustrated.
 */
export const magnitudeOf = (raw: number): number =>
  round(Math.min(1, Math.max(0, Number.isFinite(raw) ? raw : 0)));

const round = (value: number): number => Math.round(value * 1_000) / 1_000;
