/**
 * Who the companion is.
 *
 * Split into two types on purpose. `Identity` is the part that must survive
 * every model upgrade and every personality drift — if this changes, it is a
 * different companion. `PersonalityProfile` is the part that is *allowed* to
 * evolve, slowly, through experience.
 *
 * Keeping them apart is what makes "the language model is replaceable"
 * enforceable rather than aspirational: swapping providers cannot touch either,
 * because neither lives in a prompt.
 */
export interface Identity {
  readonly name: string;
  /** Immutable values. Referenced when a decision has an ethical dimension. */
  readonly coreValues: readonly string[];
  /** One paragraph the companion would use to describe itself. */
  readonly selfDescription: string;
  /** Bumped when core identity is deliberately revised. Never silently. */
  readonly version: number;
}

/**
 * A personality trait, normalised to 0–1.
 *
 * Traits *influence* decisions; they never override them. A companion with low
 * `patience` answers differently — it does not answer something untrue.
 */
export type TraitName =
  | 'curiosity'
  | 'empathy'
  | 'humor'
  | 'patience'
  | 'confidence'
  | 'playfulness'
  | 'warmth'
  | 'creativity';

export const TRAIT_NAMES = [
  'curiosity',
  'empathy',
  'humor',
  'patience',
  'confidence',
  'playfulness',
  'warmth',
  'creativity',
] as const satisfies readonly TraitName[];

/**
 * Trait magnitudes, 0–1.
 *
 * Left as plain `number` rather than branded, and the exception is deliberate.
 * Branding exists to stop one quantity being passed where a different one
 * belongs — a confidence where an importance was meant. Every value in this
 * record is the same kind of quantity, they are only ever read as a group, and
 * one guard (`isValidPersonality`) covers the whole structure. A brand here
 * would add ceremony without removing a reachable mistake.
 */
export type TraitScores = Readonly<Record<TraitName, number>>;

/**
 * Momentary state, distinct from traits.
 *
 * Traits move over months. These move within a conversation, and they decay
 * back toward baseline — a companion that stays stuck in one mood reads as
 * broken rather than as alive.
 */
export interface AdaptiveState {
  readonly energy: number;
  readonly focus: number;
  readonly engagement: number;
}

export interface PersonalityProfile {
  readonly traits: TraitScores;
  readonly adaptive: AdaptiveState;
  /** Incremented on every persisted evolution, so drift is auditable. */
  readonly revision: number;
}

/** True when every trait and adaptive value sits within 0–1. */
export const isValidPersonality = (profile: PersonalityProfile): boolean => {
  const inRange = (value: number): boolean =>
    Number.isFinite(value) && value >= 0 && value <= 1;

  return (
    TRAIT_NAMES.every((name) => inRange(profile.traits[name])) &&
    inRange(profile.adaptive.energy) &&
    inRange(profile.adaptive.focus) &&
    inRange(profile.adaptive.engagement)
  );
};

/**
 * The starting personality for a companion that has never met anyone.
 *
 * Warmth and empathy start high, humor and playfulness low: a companion should
 * earn the right to joke with someone rather than assume it. Those are the
 * traits most likely to move first, and moving upward reads as a relationship
 * developing.
 */
export const defaultPersonality = (): PersonalityProfile => ({
  traits: {
    curiosity: 0.8,
    empathy: 0.9,
    humor: 0.45,
    patience: 0.9,
    confidence: 0.65,
    playfulness: 0.35,
    warmth: 0.9,
    creativity: 0.7,
  },
  adaptive: { energy: 0.6, focus: 0.7, engagement: 0.5 },
  revision: 0,
});
