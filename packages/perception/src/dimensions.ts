import type {
  ObservationDimension,
  ObservationFamily,
  ObservationStance,
  UserEmotion,
} from '@nexa/models';

/**
 * What each dimension is, how sure anyone may ever be about it, and what it sits
 * badly beside.
 *
 * One table, and it is the whole of perception's policy. Everything the engine
 * believes about the difference between noticing a question mark and guessing at
 * someone's mood is here as data, rather than distributed through the extractors
 * as conditionals — which is what lets a reader answer "why is it only 0.5 sure
 * she is frustrated?" by reading one row.
 *
 * The asymmetry across families is the design:
 *
 * - A `question` is a fact about the message. Its ceiling is high because a
 *   question mark is not a matter of opinion.
 * - `frustration` is a claim about a person's inner state. Even stated outright
 *   it stops short of certainty, because people say "this is so frustrating"
 *   about a compiler while perfectly cheerful.
 * - Anything merely *inferred* is capped far lower again, by `POSSIBLE_CEILING`,
 *   whatever its dimension allows.
 */
export interface DimensionPolicy {
  readonly dimension: ObservationDimension;
  readonly family: ObservationFamily;

  /**
   * The most this dimension may ever be believed, at any stance.
   *
   * Never 1. Perception reports readings of an interaction, and a reading is
   * not the thing it reads — a system that could reach certainty about someone's
   * state would eventually assert one of its guesses as a fact they had told it.
   */
  readonly ceiling: number;

  /**
   * Below this, the observation is not reported at all.
   *
   * A floor rather than a filter downstream, because an observation nobody
   * should act on is one nobody should have to reason about either. What falls
   * below it is reported as `no_evidence` — looked for, not found.
   */
  readonly floor: number;

  /**
   * The dimension this one sits oddly beside, if any.
   *
   * Symmetric by convention and checked by test. Used only to *report* tension;
   * nothing here resolves it, because a person who is pleased and exhausted at
   * once is not a contradiction to be fixed.
   */
  readonly opposes: ObservationDimension | null;

  /**
   * Where this lands in Core's narrower `UserEmotion` vocabulary.
   *
   * Null for everything that is not an emotional reading. Several dimensions map
   * to one `UserEmotion` — `anxiety` and `frustration` both land near `stressed`
   * — and that collapse is the projection's, not the vocabulary's.
   */
  readonly asUserEmotion: UserEmotion | null;
}

/**
 * The ceiling on anything inferred rather than stated.
 *
 * The mechanical form of "prefer uncertainty over false certainty". A dimension
 * policy is tuning and gets adjusted; this is the promise — no chain of hints,
 * however long, produces a confident claim about what someone is feeling. Only
 * their own words can do that, and even then not entirely.
 */
export const POSSIBLE_CEILING = 0.6;

/** The most any observation may ever claim. */
export const OBSERVED_CEILING = 0.95;

const communication = (
  dimension: ObservationDimension,
  ceiling: number,
  opposes: ObservationDimension | null = null,
): DimensionPolicy => ({
  dimension,
  family: 'communication',
  ceiling,
  floor: 0.25,
  opposes,
  asUserEmotion: null,
});

const emotion = (
  dimension: ObservationDimension,
  ceiling: number,
  asUserEmotion: UserEmotion,
  opposes: ObservationDimension | null = null,
): DimensionPolicy => ({
  dimension,
  family: 'emotion',
  // Higher than elsewhere. An emotional reading that barely registered is a
  // guess about a person, and reporting it invites a companion to respond to a
  // mood nobody was in.
  floor: 0.3,
  ceiling,
  opposes,
  asUserEmotion,
});

const conversation = (
  dimension: ObservationDimension,
  ceiling: number,
  opposes: ObservationDimension | null = null,
): DimensionPolicy => ({
  dimension,
  family: 'conversation',
  ceiling,
  floor: 0.25,
  opposes,
  asUserEmotion: null,
});

const interaction = (dimension: ObservationDimension, ceiling: number): DimensionPolicy => ({
  dimension,
  family: 'interaction',
  ceiling,
  floor: 0.25,
  opposes: null,
  asUserEmotion: null,
});

export const DIMENSION_POLICIES: Readonly<Record<ObservationDimension, DimensionPolicy>> = {
  // ── communication ──────────────────────────────────────────────────────
  // Measurements of the message. High ceilings: the length of a message is not
  // a matter of opinion.
  verbosity: communication('verbosity', 0.95),
  directness: communication('directness', 0.85),
  uncertainty: communication('uncertainty', 0.9, 'certainty'),
  certainty: communication('certainty', 0.85, 'uncertainty'),
  hesitation: communication('hesitation', 0.85),
  urgency: communication('urgency', 0.85),

  // ── emotion ────────────────────────────────────────────────────────────
  // Every ceiling stops short of the communication family's, stated or not.
  // "This is so frustrating" is said by perfectly cheerful people about
  // compilers, and a system that took it at face value would spend its life
  // consoling people who were fine.
  frustration: emotion('frustration', 0.8, 'frustrated'),
  excitement: emotion('excitement', 0.8, 'excited', 'fatigue'),
  curiosity: emotion('curiosity', 0.8, 'curious'),
  sadness: emotion('sadness', 0.75, 'sad', 'joy'),
  joy: emotion('joy', 0.8, 'happy', 'sadness'),
  confusion: emotion('confusion', 0.85, 'confused'),
  anxiety: emotion('anxiety', 0.75, 'stressed', 'calm'),
  fatigue: emotion('fatigue', 0.8, 'tired', 'excitement'),
  pride: emotion('pride', 0.8, 'proud'),
  calm: emotion('calm', 0.7, 'calm', 'anxiety'),

  // ── conversation ───────────────────────────────────────────────────────
  topic_shift: conversation('topic_shift', 0.8),
  correction: conversation('correction', 0.9),
  question: conversation('question', 0.95),
  agreement: conversation('agreement', 0.85, 'disagreement'),
  disagreement: conversation('disagreement', 0.85, 'agreement'),
  greeting: conversation('greeting', 0.9),
  farewell: conversation('farewell', 0.9),

  // ── interaction ────────────────────────────────────────────────────────
  help_request: interaction('help_request', 0.9),
  planning: interaction('planning', 0.85),
  reflection: interaction('reflection', 0.8),
  brainstorming: interaction('brainstorming', 0.8),
  learning: interaction('learning', 0.8),
  casual: interaction('casual', 0.85),
};

export const policyFor = (dimension: ObservationDimension): DimensionPolicy =>
  DIMENSION_POLICIES[dimension];

/**
 * The most a given stance may claim on a given dimension.
 *
 * Two ceilings applied in series, and the second is not redundant. The
 * dimension's own ceiling is tuning; `POSSIBLE_CEILING` is the rule that
 * inference never reaches the confidence of a statement, and it holds however
 * the table is later adjusted.
 */
export const ceilingFor = (
  dimension: ObservationDimension,
  stance: ObservationStance,
): number => {
  const policy = policyFor(dimension);
  const stanceCeiling = stance === 'observed' ? OBSERVED_CEILING : POSSIBLE_CEILING;
  return Math.min(policy.ceiling, stanceCeiling);
};
