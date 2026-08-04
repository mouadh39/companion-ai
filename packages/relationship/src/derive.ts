import type {
  InitiativeLevel,
  InteractionCadence,
  PersonalizationLevel,
  Relationship,
  RelationshipProfile,
  RelationshipReason,
  Timestamp,
} from '@nexa/models';
import { RELATIONSHIP_RANK } from '@nexa/models';
import { averageGapDays, daysBetween } from './elapsed.js';
import {
  LAPSE_AFTER_DAYS,
  blockersFor,
  hasLapsed,
  nextStageAfter,
  progressToward,
  stageFor,
} from './stages.js';

/**
 * Answers "who are we to each other right now?"
 *
 * Pure, and reads no clock — `at` is supplied. Given the same record and the
 * same moment it returns the same profile, which is what lets a stored
 * relationship be explained months later against the moment it was read rather
 * than the moment someone asked.
 *
 * The stage is **recomputed** rather than taken from `relationship.type`. The
 * stored value is a cache of this calculation, and when the two disagree the
 * numbers are the truth — a record edited by hand or restored from a backup
 * should resolve to what its own history supports.
 */
export const deriveProfile = (
  relationship: Relationship,
  at: Timestamp,
): RelationshipProfile => {
  const reasons: RelationshipReason[] = [];

  const stage = stageFor(relationship, at);
  const next = nextStageAfter(stage);
  const blockers = next === null ? [] : blockersFor(relationship, next, at);
  const progress = next === null ? 1 : progressToward(relationship, next, at);

  reasons.push(
    blockers.length === 0
      ? {
          code: 'stage_requirements_met',
          detail: `At '${stage}'${next === null ? ', the final stage.' : `; '${next}' is reachable.`}`,
        }
      : {
          code: 'stage_requirements_unmet',
          detail: `At '${stage}'. ${String(blockers.length)} requirement(s) short of '${String(next)}'.`,
        },
  );

  const cadence = cadenceFor(relationship, at);
  if (cadence === 'lapsed') {
    reasons.push({
      code: 'contact_lapsed',
      detail: `No contact for ${String(Math.floor(daysBetween(relationship.lastInteractionAt, at)))} days; progression is paused.`,
    });
  } else if (cadence === 'frequent' || cadence === 'regular') {
    reasons.push({
      code: 'sustained_interaction',
      detail: `Cadence is '${cadence}' over ${String(relationship.interactionCount)} interactions.`,
    });
  }

  const collaborations =
    relationship.counters.requestsHandled + relationship.counters.plansSupported;
  if (collaborations > 0) {
    reasons.push({
      code: 'collaboration_depth',
      detail: `${String(collaborations)} exchange(s) where the companion was relied on.`,
    });
  }

  if (relationship.boundaries.length > 0) {
    reasons.push({
      code: 'boundaries_recorded',
      detail: `${String(relationship.boundaries.length)} subject(s) not to raise.`,
    });
  }

  if (relationship.inferredStyle !== null) {
    reasons.push({
      code: 'style_inferred',
      detail: `Believes '${relationship.inferredStyle}' is preferred. A stated preference outranks this.`,
    });
  }

  return {
    stage,
    dimensions: relationship.dimensions,

    initiative: initiativeFor(relationship, stage, cadence),
    personalization: personalizationFor(stage),
    cadence,
    sharedUnderstanding: sharedUnderstandingFor(relationship),

    collaboration: relationship.counters,
    inferredStyle: relationship.inferredStyle,
    boundaries: relationship.boundaries,

    nextStage: next,
    progress,
    blockers,
    rationale: reasons,
  };
};

/**
 * How often the two actually talk.
 *
 * `lapsed` wins over everything. Someone who talked daily for a year and then
 * stopped is `lapsed`, not `frequent` — reporting the historical rate would
 * describe a relationship that is no longer happening.
 */
export const cadenceFor = (
  relationship: Relationship,
  at: Timestamp,
): InteractionCadence => {
  if (relationship.interactionCount <= 1) return 'first';
  if (hasLapsed(relationship, at)) return 'lapsed';

  const gap = averageGapDays(
    relationship.firstMetAt,
    relationship.lastInteractionAt,
    relationship.interactionCount,
  );

  if (gap <= 1.5) return 'frequent';
  if (gap <= 7) return 'regular';
  return 'sporadic';
};

/**
 * How much the companion may take the lead.
 *
 * Capped at `offer`, never `lead`. A relationship — however long — is not
 * permission to start conversations; that is `UserPreferences.allowProactiveSpeech`,
 * and letting closeness reach `lead` on its own would route around a setting the
 * user controls. `@nexa/personality` enforces the same ceiling from the other
 * side.
 *
 * A lapse drops it back. Someone returning after months has not asked to be
 * led, whatever the relationship was before the silence.
 */
export const initiativeFor = (
  relationship: Relationship,
  stage: Relationship['type'],
  cadence: InteractionCadence,
): InitiativeLevel => {
  if (cadence === 'lapsed' || cadence === 'first') return 'follow';

  const reliant = relationship.dimensions.reliance >= 0.5;
  const established = RELATIONSHIP_RANK[stage] >= RELATIONSHIP_RANK.familiar;

  return reliant || established ? 'offer' : 'follow';
};

/**
 * How much the companion tailors itself to this person.
 *
 * Tied to the stage rather than to any single dimension, because
 * personalisation is the visible face of the relationship and it should move
 * only when the thing it represents does. Driving it from a dimension would let
 * it jump the moment one axis crossed a line, which is how a companion becomes
 * abruptly familiar after one good conversation.
 */
export const personalizationFor = (stage: Relationship['type']): PersonalizationLevel => {
  const rank = RELATIONSHIP_RANK[stage];
  if (rank >= RELATIONSHIP_RANK.close) return 'deep';
  if (rank >= RELATIONSHIP_RANK.familiar) return 'moderate';
  if (rank >= RELATIONSHIP_RANK.acquainted) return 'light';
  return 'none';
};

/**
 * How much can go unsaid, 0–1.
 *
 * Familiarity is most of it, raised by exchanges that actually went somewhere.
 * Deliberately conservative: assuming shared context that is not there produces
 * a companion that references things the user does not recall telling it, which
 * reads as either presumptuous or unsettling.
 */
export const sharedUnderstandingFor = (relationship: Relationship): number => {
  const { familiarity } = relationship.dimensions;
  const collaborations =
    relationship.counters.requestsHandled + relationship.counters.plansSupported;

  // Saturating rather than linear: the first ten collaborations tell you far
  // more about shared context than the hundredth.
  const depth = Math.min(0.25, collaborations / 40);
  return Math.round(Math.min(1, familiarity * 0.75 + depth) * 1_000) / 1_000;
};

export { LAPSE_AFTER_DAYS };
