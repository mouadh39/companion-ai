/**
 * The part of the companion that is *allowed* to evolve.
 *
 * Who it is — name, values, commitments, limitations — is `IdentityProfile`,
 * next door. That split is what makes "the language model is replaceable"
 * enforceable rather than aspirational: swapping providers cannot touch either,
 * because neither lives in a prompt.
 *
 * A narrow four-field `Identity` used to live here as the shape the turn
 * carried. `IdentityProfile` superseded it — the prompt is built from values,
 * commitments and limitations, and the summary would have had to grow whatever
 * the prompt needed next until it was a second, drifting definition of who the
 * companion is.
 */

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
  | 'creativity'
  | 'formality'
  | 'directness';

export const TRAIT_NAMES = [
  'curiosity',
  'empathy',
  'humor',
  'patience',
  'confidence',
  'playfulness',
  'warmth',
  'creativity',
  'formality',
  'directness',
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
 *
 * `energy` lives here rather than alongside the traits, and that placement is
 * the whole distinction: how energetic the companion *is right now* is state,
 * while how warm or direct it *tends to be* is disposition. A duplicate
 * `energy` trait would give two sources of truth for one quantity, and the
 * layer that read the stale one would be wrong in a way nothing detects.
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
 *
 * `formality` starts slightly above the midpoint for the same reason. Being too
 * casual with a stranger is harder to recover from than being a little stiff,
 * and relaxing over time reads as familiarity being earned. `directness` starts
 * mid: a companion that hedges everything is useless, one that is blunt from the
 * first message is abrasive.
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
    formality: 0.55,
    directness: 0.5,
  },
  adaptive: { energy: 0.6, focus: 0.7, engagement: 0.5 },
  revision: 0,
});
