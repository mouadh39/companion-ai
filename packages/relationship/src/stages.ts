import type {
  Relationship,
  RelationshipDimension,
  RelationshipType,
  StageBlocker,
} from '@nexa/models';
import { RELATIONSHIP_RANK, RELATIONSHIP_TYPES } from '@nexa/models';
import { daysBetween } from './elapsed.js';

/**
 * What a stage requires before it can be reached.
 *
 * Every requirement is a **conjunction**, and that is the whole mechanism
 * behind "progression requires sustained interaction rather than isolated
 * events". Three independent gates have to hold at once:
 *
 * - `interactions` — enough exchanges have happened
 * - `days` — enough calendar time has passed since first contact
 * - `dimensions` — the axes have actually risen
 *
 * Any one alone is trivially gameable. Interactions alone advance a
 * relationship through fifty messages in an afternoon; days alone advance it
 * through a month of silence; dimensions alone advance it on one unusually good
 * conversation. Requiring all three means a stage can only be reached by
 * talking regularly, over time, and having it go well — which is what the word
 * is supposed to mean.
 *
 * The day thresholds are deliberately long. `17_Relationship_Engine.md` requires
 * gradual change, and at `MAX_DIMENSION_DELTA_PER_INTERACTION` of 0.02 the
 * dimensions cannot outrun them anyway.
 */
export interface StageRequirement {
  readonly stage: RelationshipType;
  readonly interactions: number;
  readonly days: number;
  readonly dimensions: Partial<Readonly<Record<RelationshipDimension, number>>>;
}

/**
 * The ladder.
 *
 * `new` has no requirements — it is where everyone starts, and a relationship
 * cannot fail to be at least that.
 *
 * The names are the existing `RelationshipType` vocabulary rather than new
 * ones, because `@nexa/personality` already reads these and renaming a shipped
 * closed union to say the same thing differently is churn that breaks a
 * consumer. They map onto the conventional descriptions directly:
 *
 * | Stage | Reads as |
 * |---|---|
 * | `new` | First meeting |
 * | `acquainted` | Getting acquainted |
 * | `familiar` | Regular companion |
 * | `close` | Trusted companion |
 * | `trusted` | Long-term companion |
 */
export const STAGE_REQUIREMENTS: readonly StageRequirement[] = [
  {
    stage: 'new',
    interactions: 0,
    days: 0,
    dimensions: {},
  },
  {
    stage: 'acquainted',
    interactions: 5,
    days: 2,
    dimensions: { familiarity: 0.08 },
  },
  {
    stage: 'familiar',
    interactions: 25,
    days: 14,
    dimensions: { familiarity: 0.4, trust: 0.4 },
  },
  {
    stage: 'close',
    interactions: 80,
    days: 60,
    dimensions: { familiarity: 0.6, trust: 0.6, warmth: 0.55 },
  },
  {
    stage: 'trusted',
    interactions: 200,
    days: 180,
    dimensions: { familiarity: 0.75, trust: 0.8, warmth: 0.65, reliance: 0.4 },
  },
];

/**
 * How long without contact before progression pauses.
 *
 * Not a punishment. A relationship that keeps advancing through six months of
 * silence is not modelling anything real, and the stage would then say
 * something the interaction history does not support.
 */
export const LAPSE_AFTER_DAYS = 45;

/**
 * The requirements for a stage.
 *
 * Falls back to the `new` requirement — which asks for nothing — rather than
 * throwing. Every member of the closed union has an entry, so this is
 * unreachable; keeping it total means a caller supplying a stage from a
 * deserialised record cannot fail a turn the user is waiting on.
 */
const NO_REQUIREMENT: StageRequirement = {
  stage: 'new',
  interactions: 0,
  days: 0,
  dimensions: {},
};

const requirementFor = (stage: RelationshipType): StageRequirement =>
  STAGE_REQUIREMENTS.find((requirement) => requirement.stage === stage) ?? NO_REQUIREMENT;

/**
 * Every requirement `stage` does not yet meet.
 *
 * Returns all of them rather than the first, because "you need 60 more
 * exchanges" is unhelpful when 100 more days are also required. A caller
 * showing progress needs the whole set to know which gate actually binds.
 */
export const blockersFor = (
  relationship: Relationship,
  stage: RelationshipType,
  at: string,
): readonly StageBlocker[] => {
  const requirement = requirementFor(stage);
  const blockers: StageBlocker[] = [];

  if (relationship.interactionCount < requirement.interactions) {
    blockers.push({
      kind: 'insufficient_interactions',
      subject: 'interactions',
      have: relationship.interactionCount,
      need: requirement.interactions,
    });
  }

  const known = daysBetween(relationship.firstMetAt, at);
  if (known < requirement.days) {
    blockers.push({
      kind: 'insufficient_elapsed_time',
      subject: 'days known',
      have: Math.floor(known),
      need: requirement.days,
    });
  }

  for (const [dimension, threshold] of Object.entries(requirement.dimensions)) {
    const have = relationship.dimensions[dimension as RelationshipDimension];
    if (have < threshold) {
      blockers.push({
        kind: 'dimension_below_threshold',
        subject: dimension,
        have,
        need: threshold,
      });
    }
  }

  // Checked last and reported alongside the rest. A lapse does not replace the
  // other blockers — someone returning after a year still needs the exchanges
  // and the dimensions, and hiding those behind the lapse would make the
  // relationship look one contact away from advancing when it is not.
  if (hasLapsed(relationship, at)) {
    blockers.push({
      kind: 'contact_lapsed',
      subject: 'days since last contact',
      have: Math.floor(daysBetween(relationship.lastInteractionAt, at)),
      need: LAPSE_AFTER_DAYS,
    });
  }

  return blockers;
};

/** True when contact has gone quiet for long enough to pause progression. */
export const hasLapsed = (relationship: Relationship, at: string): boolean =>
  daysBetween(relationship.lastInteractionAt, at) >= LAPSE_AFTER_DAYS;

/**
 * The highest stage whose requirements are met.
 *
 * Walks from the top down and returns the first that qualifies, rather than
 * stepping up one at a time. That makes the function total over any record,
 * including one restored from a backup or edited by hand — a relationship whose
 * stored stage disagrees with its own numbers resolves to what the numbers
 * support, which is the auditable answer.
 */
export const stageFor = (relationship: Relationship, at: string): RelationshipType => {
  for (let i = STAGE_REQUIREMENTS.length - 1; i >= 0; i--) {
    const requirement = STAGE_REQUIREMENTS[i];
    if (requirement === undefined) continue;
    if (blockersFor(relationship, requirement.stage, at).length === 0) {
      return requirement.stage;
    }
  }
  return 'new';
};

/** The stage after this one, or null at the top. */
export const nextStageAfter = (stage: RelationshipType): RelationshipType | null =>
  RELATIONSHIP_TYPES[RELATIONSHIP_RANK[stage] + 1] ?? null;

/**
 * How far along the current stage is toward the next, 0–1.
 *
 * The *minimum* of the per-requirement ratios, not the mean. A relationship
 * that has met the interaction count but not a single day of the elapsed
 * requirement is not "half way" — it is blocked, and averaging would report
 * progress that no amount of talking today can convert into a stage.
 */
export const progressToward = (
  relationship: Relationship,
  stage: RelationshipType,
  at: string,
): number => {
  const requirement = requirementFor(stage);
  const ratios: number[] = [];

  if (requirement.interactions > 0) {
    ratios.push(relationship.interactionCount / requirement.interactions);
  }
  if (requirement.days > 0) {
    ratios.push(daysBetween(relationship.firstMetAt, at) / requirement.days);
  }
  for (const [dimension, threshold] of Object.entries(requirement.dimensions)) {
    if (threshold > 0) {
      ratios.push(relationship.dimensions[dimension as RelationshipDimension] / threshold);
    }
  }

  if (ratios.length === 0) return 1;
  // A lapse zeroes it. Progress that cannot currently be converted into a stage
  // is not progress the user should be shown as accumulating.
  if (hasLapsed(relationship, at)) return 0;

  return Math.min(1, Math.max(0, Math.min(...ratios)));
};
