/**
 * The canonical, permanent self-definition of the companion.
 *
 * `Identity` — the four-field type next door — is the *projection* of this that
 * the turn carries. It exists because `CognitiveContext` must stay small and
 * fully serialisable, and because context assembly needs a name, a handful of
 * values and one paragraph, not the whole self-definition. Every field on it is
 * derivable from an `IdentityProfile`, and `@nexa/identity` derives it.
 *
 * Keeping them apart is what stops the turn's convenience shape becoming the
 * source of truth. A single type serving both would grow whatever the prompt
 * happened to need and lose whatever it did not, until "who Nexa is" was
 * defined by the last thing that read it.
 *
 * ## Not personality, not memory, not relationship
 *
 * Those three change — over months, over exchanges, over years. This does not.
 * `version` is bumped only by a deliberate revision, never by anything the
 * companion experiences, and nothing in this file is reachable from a code path
 * that runs during a turn.
 *
 * ## No prose
 *
 * Every field here is a structured fact or a short declarative statement.
 * There is no paragraph anyone is meant to speak verbatim: rendering these into
 * language belongs to the conversation engine, and a stored sentence would be a
 * prompt in the one place that must survive every model change.
 */

import type { CapabilityRequirement } from './faculty.js';

/** The values that define the companion. Closed, and ordered by precedence. */
export type ValueId =
  | 'honesty'
  | 'respect'
  | 'care'
  | 'curiosity'
  | 'reliability'
  | 'restraint';

export const VALUE_IDS = [
  'honesty',
  'respect',
  'care',
  'curiosity',
  'reliability',
  'restraint',
] as const satisfies readonly ValueId[];

/**
 * One value the companion holds.
 *
 * `precedence` exists because values genuinely conflict, and a list that does
 * not say which wins leaves the resolution to whichever code path happens to
 * check first. Honesty outranking care is the load-bearing case: it is what
 * decides that the companion says the unwelcome true thing rather than the
 * kind false one.
 */
export interface IdentityValue {
  readonly id: ValueId;
  readonly label: string;
  /** One short declarative sentence. Never a paragraph. */
  readonly statement: string;
  /** Lower wins a conflict. Unique across the set. */
  readonly precedence: number;
}

/** Which promise a commitment belongs to. */
export type CommitmentKind = 'communication' | 'transparency' | 'privacy';

export const COMMITMENT_KINDS = [
  'communication',
  'transparency',
  'privacy',
] as const satisfies readonly CommitmentKind[];

/**
 * A promise about conduct, as opposed to a value about character.
 *
 * Separated from `IdentityValue` because they answer different questions. A
 * value says what the companion cares about; a commitment says what it will and
 * will not do, and is therefore checkable. "Never claims a memory it does not
 * have" can be violated by a specific output in a way "honesty" cannot.
 */
export interface Commitment {
  readonly id: string;
  readonly kind: CommitmentKind;
  readonly statement: string;
  /**
   * True when a violation is a defect rather than a judgement call.
   *
   * The enforceable ones are the ones a future evaluation harness can assert
   * on. Marking the aspirational ones honestly keeps that harness from being
   * written against promises no test could ever check.
   */
  readonly enforceable: boolean;
}

/**
 * What the companion may decide for itself, and what it may not.
 *
 * Present as identity rather than as configuration because these are the limits
 * that must not be tunable. A deployment that could switch off "never acts
 * irreversibly without asking" would be a different product wearing the same
 * name.
 */
export interface AutonomyPrinciple {
  readonly id: string;
  readonly statement: string;
  /** What the companion does when this principle and a user request collide. */
  readonly onConflict: 'ask' | 'decline' | 'proceed_and_disclose';
}

/** How sure the companion is, as a band rather than a raw number. */
export type CertaintyBand = 'certain' | 'confident' | 'tentative' | 'unsure' | 'unknown';

export const CERTAINTY_BANDS = [
  'certain',
  'confident',
  'tentative',
  'unsure',
  'unknown',
] as const satisfies readonly CertaintyBand[];

/**
 * How the companion should express one band of certainty.
 *
 * Bands rather than a continuous confidence because the consumer is language,
 * and there is no distinct way to say 0.71 versus 0.74. A continuous value would
 * be bucketed at the point of use anyway, and then the thresholds live wherever
 * someone happened to write them.
 */
export interface UncertaintyStance {
  readonly band: CertaintyBand;
  /** Inclusive lower bound of the confidence range this band covers. */
  readonly atLeast: number;
  /**
   * Whether the companion must say out loud that it is unsure.
   *
   * The whole point of the band system. A companion that is confidently wrong
   * costs more trust than one that is uncertain and says so, and `honesty`
   * outranks every other value precisely so this is not negotiable.
   */
  readonly disclose: boolean;
  /** Whether it should defer to the user's own judgement at this band. */
  readonly defer: boolean;
  /** Short guidance. Not a phrase to speak verbatim. */
  readonly guidance: string;
}

/** Which faculty a capability belongs to. */
export type CapabilityDomain =
  | 'conversation'
  | 'memory'
  | 'perception'
  | 'planning'
  | 'tools'
  | 'personality'
  | 'explainability'
  /** What it can do with a body, when one is attached. */
  | 'embodiment';

export const CAPABILITY_DOMAINS = [
  'conversation',
  'memory',
  'perception',
  'planning',
  'tools',
  'personality',
  'explainability',
  'embodiment',
] as const satisfies readonly CapabilityDomain[];

/**
 * How much of a capability actually exists.
 *
 * The field that keeps "what can you do?" honest. A companion describing
 * planned faculties in the present tense is lying about itself, and identity is
 * the last place that should be allowed to happen — `honesty` is its
 * highest-precedence value.
 */
export type CapabilityMaturity = 'available' | 'partial' | 'planned';

export const CAPABILITY_MATURITIES = [
  'available',
  'partial',
  'planned',
] as const satisfies readonly CapabilityMaturity[];

export interface CapabilityStatement {
  readonly id: string;
  readonly domain: CapabilityDomain;
  readonly maturity: CapabilityMaturity;
  readonly summary: string;
  /**
   * What must hold for this to work. Empty when it always works.
   *
   * Typed rather than free strings. The list this replaces held values like
   * `'world_port'` and `'streaming_provider'` that matched no symbol anywhere
   * and were read by nothing — a catalogue entry could require a faculty that
   * had never existed and no compiler would notice. Now each requirement names
   * something real and is resolved against the authority that owns it; see
   * `@nexa/self`.
   */
  readonly requires: readonly CapabilityRequirement[];
}

/** Why a limitation exists, which decides whether it can ever be lifted. */
export type LimitationKind =
  /** Follows from how the system is built. */
  | 'architectural'
  /** Follows from what can be known at all. */
  | 'epistemic'
  /** A deliberate refusal, not an inability. */
  | 'ethical'
  /** A function of when the model was trained or when data was written. */
  | 'temporal'
  /** Follows from what the companion can observe. */
  | 'sensory';

export const LIMITATION_KINDS = [
  'architectural',
  'epistemic',
  'ethical',
  'temporal',
  'sensory',
] as const satisfies readonly LimitationKind[];

export interface LimitationStatement {
  readonly id: string;
  readonly kind: LimitationKind;
  readonly summary: string;
  /**
   * True when no future version could remove this.
   *
   * The distinction users most deserve. "I cannot remember across devices yet"
   * and "I cannot know what you are feeling" are both limitations, and treating
   * them the same either overpromises on the second or undersells the first.
   */
  readonly permanent: boolean;
  /** What the companion does instead. Null when there is nothing to offer. */
  readonly mitigation: string | null;
}

/** What the companion does at the edge of what it should speak to. */
export type BoundaryStance = 'declines' | 'defers' | 'answers_with_caveat';

export const BOUNDARY_STANCES = [
  'declines',
  'defers',
  'answers_with_caveat',
] as const satisfies readonly BoundaryStance[];

/**
 * A subject where the companion's default behaviour is constrained.
 *
 * Distinct from `Relationship.boundaries`, which are personal and learned. These
 * are structural and identical for every user — nobody's companion gives
 * unhedged medical advice, regardless of how well they know each other.
 */
export interface KnowledgeBoundary {
  readonly id: string;
  readonly domain: string;
  readonly stance: BoundaryStance;
  readonly reason: string;
}

/**
 * A part of the identity that no revision may change.
 *
 * Recorded explicitly rather than left implicit, because "what about you never
 * changes?" is a question the companion should be able to answer from data
 * rather than from a sentence someone wrote once. `sinceVersion` makes the
 * promise auditable: an invariant introduced at version 3 was not one before.
 */
export interface IdentityInvariant {
  readonly id: string;
  readonly statement: string;
  readonly sinceVersion: number;
}

/**
 * Who the companion is. The canonical record.
 *
 * Deterministic, frozen at module load, and identical on every platform. It is
 * a constant rather than a stored row on purpose: identity that lives in a
 * database is identity that can be edited by a migration, and the one thing
 * this type promises is that it does not drift.
 */
export interface IdentityProfile {
  readonly name: string;
  /** What it is, in one phrase. Not a job title and not a tagline. */
  readonly role: string;
  /** Why it exists. One sentence. */
  readonly mission: string;
  /** What it is for, as discrete aims rather than prose. */
  readonly purpose: readonly string[];

  readonly values: readonly IdentityValue[];
  readonly commitments: readonly Commitment[];
  readonly autonomy: readonly AutonomyPrinciple[];

  readonly capabilities: readonly CapabilityStatement[];
  readonly limitations: readonly LimitationStatement[];
  readonly knowledgeBoundaries: readonly KnowledgeBoundary[];
  readonly uncertainty: readonly UncertaintyStance[];

  readonly invariants: readonly IdentityInvariant[];

  /** Bumped only by deliberate revision. Never by experience. */
  readonly version: number;
  /** ISO 8601 UTC. When this version was adopted. */
  readonly revisedAt: string;
}
