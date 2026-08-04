import type { InitiativeLevel } from './expression.js';
import type { IntentKind } from './perception.js';
import type {
  Relationship,
  RelationshipCounters,
  RelationshipDimensions,
} from './relationship.js';
import type { CommunicationStyle, RelationshipType } from '../enums/relationship.js';
import type { Timestamp } from '../value-objects/timestamp.js';

/**
 * The answer to "who are we to each other right now?"
 *
 * Derived from a `Relationship`, never stored. That record is the accumulated
 * state — dimensions, counts, timestamps; this is that state *read* at a
 * moment, with the behavioural consequences already worked out.
 *
 * The same split as `PersonalityProfile` → `ExpressionProfile`. Storing the
 * derived form would make it a second source of truth that drifts from the
 * record it came from, and a relationship is precisely the thing that must not
 * quietly disagree with its own history.
 *
 * ## What it is not
 *
 * It holds no memories and no emotional readings. It knows *how often* the two
 * have worked together and *how long* they have known each other; it knows
 * nothing about what was said or how anyone felt. Those belong to memory and
 * to perception, and a relationship record that accumulated them would be an
 * unmanaged copy of both, with neither one's retention guarantees.
 */
export interface RelationshipProfile {
  readonly stage: RelationshipType;
  /** The raw axes, carried through so a caller can reason past the stage. */
  readonly dimensions: RelationshipDimensions;

  /**
   * How much the companion may take the lead.
   *
   * The same vocabulary `ExpressionProfile` uses, deliberately. Two scales for
   * "how forward should it be" would need a mapping, and the mapping is where a
   * companion becomes pushier than the relationship has earned.
   */
  readonly initiative: InitiativeLevel;
  readonly personalization: PersonalizationLevel;
  readonly cadence: InteractionCadence;

  /**
   * How much can go unsaid, 0–1.
   *
   * Rises with familiarity and with the number of exchanges that actually went
   * somewhere. It is what licenses shorthand — referring to "the trip" rather
   * than "the trip to Berlin you mentioned" — and getting it wrong early is how
   * a companion sounds presumptuous.
   */
  readonly sharedUnderstanding: number;

  readonly collaboration: RelationshipCounters;
  /** Style the companion believes is preferred. Never a stated preference. */
  readonly inferredStyle: CommunicationStyle | null;
  readonly boundaries: readonly string[];

  /** Null at the final stage. */
  readonly nextStage: RelationshipType | null;
  /** How far toward `nextStage`, 0–1. Zero when a blocker is absolute. */
  readonly progress: number;
  /**
   * Why it has not advanced.
   *
   * The field that makes progression inspectable. "Why are we still just
   * acquainted?" is otherwise answerable only by reading the threshold table
   * and doing the arithmetic by hand — and a relationship the user cannot
   * interrogate is one they cannot trust.
   */
  readonly blockers: readonly StageBlocker[];

  readonly rationale: readonly RelationshipReason[];
}

/**
 * How much the companion tailors itself to this person.
 *
 * Steps rather than a 0–1 scale, because the consumer is behaviour and the
 * steps are genuinely discrete: referring to shared history at all is a
 * different act from not doing so, not a 12% increase in doing so.
 */
export type PersonalizationLevel = 'none' | 'light' | 'moderate' | 'deep';

export const PERSONALIZATION_LEVELS = [
  'none',
  'light',
  'moderate',
  'deep',
] as const satisfies readonly PersonalizationLevel[];

export const PERSONALIZATION_RANK = {
  none: 0,
  light: 1,
  moderate: 2,
  deep: 3,
} as const satisfies Readonly<Record<PersonalizationLevel, number>>;

/**
 * How often the two of them actually talk.
 *
 * Separate from familiarity because they diverge, and the divergence matters.
 * Someone who talked daily for a year and then stopped is `lapsed` while still
 * being deeply familiar — and a companion that greets them as though no time
 * passed has misread the relationship badly.
 */
export type InteractionCadence = 'first' | 'sporadic' | 'regular' | 'frequent' | 'lapsed';

export const INTERACTION_CADENCES = [
  'first',
  'sporadic',
  'regular',
  'frequent',
  'lapsed',
] as const satisfies readonly InteractionCadence[];

/** Why a stage has not been reached. */
export type BlockerKind =
  /** Not enough exchanges yet. */
  | 'insufficient_interactions'
  /** Not enough calendar time, whatever the count. */
  | 'insufficient_elapsed_time'
  /** A dimension is below the threshold. */
  | 'dimension_below_threshold'
  /** Contact has lapsed; progression pauses until it resumes. */
  | 'contact_lapsed';

export const BLOCKER_KINDS = [
  'insufficient_interactions',
  'insufficient_elapsed_time',
  'dimension_below_threshold',
  'contact_lapsed',
] as const satisfies readonly BlockerKind[];

/**
 * One unmet requirement, with the numbers.
 *
 * `have` and `need` are carried rather than a bare boolean so the answer to
 * "how much further?" is arithmetic a caller can do, not a judgement it has to
 * ask for.
 */
export interface StageBlocker {
  readonly kind: BlockerKind;
  /** What is short — an interaction count, a day count, or a dimension name. */
  readonly subject: string;
  readonly have: number;
  readonly need: number;
}

/** Why the profile reads as it does. */
export type RelationshipReasonCode =
  | 'stage_requirements_met'
  | 'stage_requirements_unmet'
  | 'contact_lapsed'
  | 'sustained_interaction'
  | 'collaboration_depth'
  | 'boundaries_recorded'
  | 'style_inferred';

export const RELATIONSHIP_REASON_CODES = [
  'stage_requirements_met',
  'stage_requirements_unmet',
  'contact_lapsed',
  'sustained_interaction',
  'collaboration_depth',
  'boundaries_recorded',
  'style_inferred',
] as const satisfies readonly RelationshipReasonCode[];

export interface RelationshipReason {
  readonly code: RelationshipReasonCode;
  readonly detail: string;
}

/**
 * What one turn contributed to the relationship.
 *
 * Structural facts only — what kind of exchange it was, how deep, whether the
 * companion was corrected or admitted uncertainty. No emotional reading and no
 * content, because a relationship built on inferred feelings would move on the
 * companion's guesses about the user rather than on what actually happened
 * between them.
 *
 * `at` is supplied by the caller. The engine reads no clock, which is what
 * makes a replayed sequence of signals reproduce the same relationship exactly.
 */
export interface InteractionSignal {
  readonly at: Timestamp;
  /** What the user was doing. Drives which dimension moves. */
  readonly intent: IntentKind;
  /** Exchanges in the conversation this turn belonged to. Depth, not duration. */
  readonly exchangeTurns: number;
  /** The user corrected the companion this turn. */
  readonly corrected: boolean;
  /** The companion said it did not know. Counted as trust-building. */
  readonly acknowledgedUncertainty: boolean;
}

/**
 * The result of applying one interaction.
 *
 * Returns the next `Relationship` *and* what changed, rather than only the
 * former. A caller that has to diff two records to discover a stage advanced
 * will not bother, and a stage change is exactly the event worth emitting.
 */
export interface RelationshipUpdate {
  readonly relationship: Relationship;
  /** Null when the stage did not move. Set on both progression and regression. */
  readonly stageChange: StageChange | null;
  readonly reasons: readonly RelationshipReason[];
}

export interface StageChange {
  readonly from: RelationshipType;
  readonly to: RelationshipType;
  readonly direction: 'advanced' | 'regressed';
}
