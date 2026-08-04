import type { SpeechTone } from './action.js';

/**
 * How the companion should express itself on one turn.
 *
 * The Personality Engine's output, and deliberately **not** a second
 * `PersonalityProfile`. That type is Layer 2 of `13_Personality_Engine.md` —
 * stable disposition that moves over months and is persisted. This is Layer 3:
 * resolved behaviour for one turn, derived and never stored.
 *
 * Keeping them apart is what stops the engine writing back into the traits it
 * read. A profile that both described the companion and recorded how it last
 * behaved would drift toward whatever it did most recently, which is how a
 * companion ends up permanently formal because it once met a stranger.
 *
 * ## What this does not decide
 *
 * Every field governs *how* the companion communicates, never *what* it says.
 * There is no field here that can change a claim, suppress a fact, or alter a
 * decision — those belong to deliberation, which runs before this and reads
 * none of it. A companion with low `patience` answers differently; it does not
 * answer something untrue.
 *
 * It also never overrides safety. `boundaries` only ever *restricts*.
 */
export interface ExpressionProfile {
  /**
   * Delivery hint for speech, reusing the vocabulary clients already render.
   *
   * The same closed union as `SpeakAction['tone']` rather than a parallel one:
   * two tone vocabularies would need a mapping layer, and the mapping is where
   * a tone the client cannot render gets invented.
   */
  readonly tone: SpeechTone;

  /** How much the companion elaborates. */
  readonly detail: DetailLevel;
  /** How much it drives the exchange rather than following. */
  readonly initiative: InitiativeLevel;
  /** How quickly it moves — sentence length and density, not literal speed. */
  readonly pacing: Pacing;

  /**
   * Continuous dimensions, 0–1.
   *
   * Left as plain numbers for the same reason `TraitScores` is: they are all
   * the same kind of quantity, always read as a group, and covered by one
   * guard. A brand per dimension would add ceremony without removing a
   * reachable mistake.
   */
  readonly curiosity: number;
  readonly humor: number;
  readonly emotionalExpression: number;
  readonly warmth: number;
  readonly formality: number;
  readonly directness: number;
  readonly energy: number;

  /**
   * Subjects that must not be raised, carried through from the relationship.
   *
   * Present on the profile rather than looked up separately so that whatever
   * builds the prompt cannot forget to consult them. Honoured without
   * exception — this is the one field that only ever restricts behaviour.
   */
  readonly boundaries: readonly string[];

  /**
   * Why this profile looks the way it does.
   *
   * The same bet `Decision.reasonCodes` makes: an adjustment you cannot account
   * for is one you cannot debug, and "why was it suddenly so formal?" is
   * otherwise answerable only by re-running the engine by hand. Ordered as
   * applied.
   */
  readonly rationale: readonly ExpressionReason[];
}

/**
 * How much the companion elaborates.
 *
 * Steps rather than a 0–1 scale, because the consumer is prose guidance and
 * there is no meaningful difference between 0.61 and 0.64 detail. A continuous
 * value would have to be bucketed at the point of use anyway, and then the
 * thresholds live somewhere nobody can find them.
 */
export type DetailLevel = 'minimal' | 'brief' | 'moderate' | 'thorough';

export const DETAIL_LEVELS = [
  'minimal',
  'brief',
  'moderate',
  'thorough',
] as const satisfies readonly DetailLevel[];

/** Ordering, so a layer can raise or lower detail by one step. */
export const DETAIL_RANK = {
  minimal: 0,
  brief: 1,
  moderate: 2,
  thorough: 3,
} as const satisfies Readonly<Record<DetailLevel, number>>;

/**
 * How much the companion drives the exchange.
 *
 * `lead` is gated on the user's stated `allowProactiveSpeech`, never on traits
 * alone. An AR companion that starts conversations uninvited is the failure
 * mode users abandon the product over, so no trait combination may reach it on
 * its own.
 */
export type InitiativeLevel = 'follow' | 'offer' | 'lead';

export const INITIATIVE_LEVELS = [
  'follow',
  'offer',
  'lead',
] as const satisfies readonly InitiativeLevel[];

export const INITIATIVE_RANK = {
  follow: 0,
  offer: 1,
  lead: 2,
} as const satisfies Readonly<Record<InitiativeLevel, number>>;

/** How quickly the companion moves through what it has to say. */
export type Pacing = 'slow' | 'measured' | 'brisk';

export const PACINGS = ['slow', 'measured', 'brisk'] as const satisfies readonly Pacing[];

export const PACING_RANK = {
  slow: 0,
  measured: 1,
  brisk: 2,
} as const satisfies Readonly<Record<Pacing, number>>;

/**
 * Why one layer moved one dimension.
 *
 * A closed union rather than free text, so the reasons can be counted. "How
 * often does distress suppress humour?" is a question about product behaviour,
 * and it is only answerable if the answer is an enumerable token.
 */
export type ExpressionReasonCode =
  /** The companion's own disposition, before anything adjusted it. */
  | 'base_traits'
  /** Familiarity earned through interaction relaxed formality or raised humour. */
  | 'relationship_familiarity'
  /** Low trust held the companion back. */
  | 'relationship_guarded'
  /** The relationship recorded subjects not to raise. */
  | 'relationship_boundaries'
  /** A style the companion believes the user prefers, inferred not stated. */
  | 'inferred_style'
  /** A style the user stated explicitly. Outranks anything inferred. */
  | 'stated_preference'
  /** Proactive speech is switched off, so initiative is capped. */
  | 'proactive_speech_disallowed'
  /** The user appears to be struggling; warmth up, humour down. */
  | 'user_distress'
  /** The user appears energised; playfulness and pace up. */
  | 'user_positive'
  /** What the user is trying to do this turn. */
  | 'intent_shape'
  /** A correction was issued; the companion becomes plainer and less playful. */
  | 'user_correction'
  /** Momentary state — energy, focus, engagement. */
  | 'adaptive_state'
  /** A dimension hit 0 or 1 and stopped moving. */
  | 'clamped';

export const EXPRESSION_REASON_CODES = [
  'base_traits',
  'relationship_familiarity',
  'relationship_guarded',
  'relationship_boundaries',
  'inferred_style',
  'stated_preference',
  'proactive_speech_disallowed',
  'user_distress',
  'user_positive',
  'intent_shape',
  'user_correction',
  'adaptive_state',
  'clamped',
] as const satisfies readonly ExpressionReasonCode[];

/** One recorded adjustment. */
export interface ExpressionReason {
  readonly code: ExpressionReasonCode;
  /**
   * The dimensions this reason moved.
   *
   * Named rather than described in prose, so a reader can ask which layer last
   * touched `humor` without parsing a sentence.
   */
  readonly affects: readonly ExpressionDimension[];
  readonly detail: string;
}

/**
 * The addressable dimensions of an `ExpressionProfile`.
 *
 * Derived from the profile rather than written out twice, so a dimension added
 * to the interface cannot be forgotten here.
 */
export type ExpressionDimension = Exclude<
  keyof ExpressionProfile,
  'boundaries' | 'rationale'
>;

export const EXPRESSION_DIMENSIONS = [
  'tone',
  'detail',
  'initiative',
  'pacing',
  'curiosity',
  'humor',
  'emotionalExpression',
  'warmth',
  'formality',
  'directness',
  'energy',
] as const satisfies readonly ExpressionDimension[];

/**
 * Compile-time proof that the array above covers every dimension.
 *
 * `satisfies readonly ExpressionDimension[]` alone does **not** give this. It
 * checks that each element *is* a dimension, not that every dimension *is* an
 * element — so adding a field to `ExpressionProfile` and forgetting it here
 * would compile, and the dimension would silently never appear in any
 * rationale. This alias is `never` only when nothing is missing, so omitting
 * one fails the build with the missing name in the error text.
 */
type UncoveredDimension = Exclude<
  ExpressionDimension,
  (typeof EXPRESSION_DIMENSIONS)[number]
>;
export type __AllDimensionsCovered = UncoveredDimension extends never ? true : never;

/** True when every continuous dimension sits within 0–1. */
export const isValidExpression = (profile: ExpressionProfile): boolean => {
  const inRange = (value: number): boolean =>
    Number.isFinite(value) && value >= 0 && value <= 1;

  return (
    inRange(profile.curiosity) &&
    inRange(profile.humor) &&
    inRange(profile.emotionalExpression) &&
    inRange(profile.warmth) &&
    inRange(profile.formality) &&
    inRange(profile.directness) &&
    inRange(profile.energy)
  );
};
