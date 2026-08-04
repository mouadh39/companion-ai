import type {
  ClarificationNeed,
  DetailLevel,
  FollowUp,
  InitiativeLevel,
  MemoryOpportunity,
  Objective,
  Pacing,
  PlanConstraint,
  PlanHorizon,
  Strategy,
} from '@nexa/models';
import type { PlanningConfig } from './config.js';
import { DETAIL_RANKS, INITIATIVE_RANKS, PACING_RANKS } from './config.js';
import type { Situation } from './situation.js';
import { policyFor } from './strategies.js';

/**
 * Turning a chosen strategy into the rest of the plan.
 *
 * Everything here follows from the strategy and the situation, deterministically
 * and by explicit rule. Nothing is invented: the objectives come from the
 * strategy's own policy, the manner comes from expression capped by caution, and
 * the follow-up and memory opportunities come from things the situation actually
 * contains.
 */

/**
 * How the turn should be carried.
 *
 * Planning may only ever move these **down** from what expression proposed, and
 * that direction is the design. Expression composed initiative, pacing and depth
 * from personality, relationship and the moment — it already knows what the
 * relationship has earned. A planner that could raise them would be overriding
 * that judgement with a narrower one, and the failure mode has a name: a
 * companion that decides, on the strength of one turn, that it is time to take
 * the lead.
 *
 * Lowering is always legitimate. Being more careful than the relationship
 * strictly requires costs nothing anyone will resent.
 */
export interface Manner {
  readonly initiative: InitiativeLevel;
  readonly pacing: Pacing;
  readonly explanationDepth: DetailLevel;
  readonly capped: boolean;
}

const lowerOf = <T extends string>(
  a: T,
  b: T,
  ranks: Readonly<Record<T, number>>,
): T => (ranks[a] <= ranks[b] ? a : b);

/** What a strategy's assertiveness allows, as a ceiling on initiative. */
const initiativeCeiling = (strategy: Strategy): InitiativeLevel => {
  const assertiveness = policyFor(strategy).assertiveness;
  if (assertiveness <= 0.2) return 'follow';
  if (assertiveness <= 0.6) return 'offer';
  return 'lead';
};

export const mannerFor = (
  strategy: Strategy,
  situation: Situation,
  constraints: readonly PlanConstraint[],
  config: PlanningConfig,
): Manner => {
  const proposed = situation.proposed;

  // With no expression composed in, start from the middle rather than from the
  // top. An absent personality is not permission to be forward.
  let initiative: InitiativeLevel = proposed?.initiative ?? 'offer';
  let pacing: Pacing = proposed?.pacing ?? 'measured';
  let depth: DetailLevel = proposed?.detail ?? 'moderate';
  const before = { initiative, pacing, depth };

  initiative = lowerOf(initiative, config.maxInitiative, INITIATIVE_RANKS);
  initiative = lowerOf(initiative, initiativeCeiling(strategy), INITIATIVE_RANKS);

  if (constraints.includes('slow_down')) pacing = lowerOf(pacing, 'slow', PACING_RANKS);
  if (constraints.includes('simplify')) depth = lowerOf(depth, 'brief', DETAIL_RANKS);
  if (constraints.includes('defer_to_user_judgement')) {
    initiative = lowerOf(initiative, 'follow', INITIATIVE_RANKS);
  }
  if (situation.urgent) pacing = lowerOf(pacing, 'brisk', PACING_RANKS);

  return {
    initiative,
    pacing,
    explanationDepth: depth,
    capped:
      initiative !== before.initiative ||
      pacing !== before.pacing ||
      depth !== before.depth,
  };
};

/** The objectives a strategy serves, filtered to what the situation supports. */
export const objectivesFor = (
  strategy: Strategy,
  situation: Situation,
  config: PlanningConfig,
): { readonly primary: Objective; readonly secondary: readonly Objective[] } => {
  const policy = policyFor(strategy);
  const secondary = new Set<Objective>(policy.alsoServes);

  if (situation.planInProgress || situation.hasHistory) secondary.add('preserve_continuity');
  if (situation.corrected) secondary.add('confirm_understanding');
  if (situation.servingGoals.length > 0 && situation.wellGrounded) {
    secondary.add('preserve_continuity');
  }

  secondary.delete(policy.objective);

  return {
    primary: policy.objective,
    // Sorted then truncated, so which secondary objectives survive a cap does
    // not depend on the order the rules above happened to run.
    secondary: [...secondary].sort().slice(0, config.maxSecondaryObjectives),
  };
};

/**
 * What must be established first, if anything.
 *
 * Carries the reason and never the question. Writing the question is generation's
 * job — a plan holding a sentence would be a plan that had started doing
 * generation's work, and the two would stop being separately testable.
 */
export const clarificationFor = (
  situation: Situation,
  constraints: readonly PlanConstraint[],
  config: PlanningConfig,
): ClarificationNeed | null => {
  const blocking = constraints.includes('require_clarification_before_acting');

  if (situation.silent) return null;

  if (situation.conflicted) {
    return {
      reason: 'conflicting_signals',
      blocking,
      about: [],
      detail: 'Perception found readings that sit oddly together.',
    };
  }
  if (situation.identityBoundary !== null) {
    return {
      reason: 'boundary_touched',
      blocking,
      about: [situation.identityBoundary],
      detail: 'The subject is one identity constrains.',
    };
  }
  if (situation.clarity < config.clarityFloor) {
    return {
      reason: 'intent_unclear',
      blocking,
      about: [],
      detail: `Clarity ${situation.clarity.toFixed(2)} is under the ${config.clarityFloor.toFixed(2)} floor.`,
    };
  }
  if (situation.ungrounded && (situation.asked || situation.askedForHelp)) {
    return {
      reason: 'missing_context',
      blocking: false,
      about: [],
      detail: 'Something was asked and retrieval found nothing to answer it from.',
    };
  }

  return null;
};

/**
 * Whether to come back to something, and when.
 *
 * A recommendation and nothing more. Planning schedules nothing — there is no
 * timer, no job, no reminder row — because scheduling is an effect and this
 * engine has none. Whoever owns the next turn decides whether to act on it.
 */
export const followUpFor = (
  strategy: Strategy,
  situation: Situation,
): FollowUp | null => {
  if (situation.silent) return null;

  // Ordered by what would be worst to forget. A stuck plan step and a person
  // having a hard time both outrank confirming that an explanation landed —
  // checking understanding is the most common follow-up and the least costly one
  // to lose, so it must not shadow the other two by being tested first.
  if (situation.planBlocked) {
    return {
      kind: 'revisit_goal',
      when: 'this_conversation',
      subject: situation.servingGoals[0] ?? null,
      detail: 'A plan step cannot proceed and will need returning to.',
    };
  }
  if (situation.distressed && situation.statedFeeling !== null) {
    return {
      kind: 'ask_how_it_went',
      when: 'later',
      subject: null,
      detail: `The user stated they feel '${situation.statedFeeling.dimension}'.`,
    };
  }
  if (strategy === 'teach_stepwise' || strategy === 'clarify_first') {
    return {
      kind: 'check_understanding',
      when: 'next_turn',
      subject: null,
      detail: 'The turn asks something or explains in steps; confirm it landed.',
    };
  }
  if (situation.shifted && situation.hasHistory) {
    return {
      kind: 'return_to_deferred_topic',
      when: 'this_conversation',
      subject: null,
      detail: 'The subject changed; what was being discussed was left open.',
    };
  }

  return null;
};

/**
 * Things this turn contained that memory might want.
 *
 * Pointers, never writes. Planning noticing that a preference was just stated is
 * useful; planning storing it would put a second, unreviewed writer into a
 * subsystem with its own floors, permission checks and formation rules.
 */
export const memoryOpportunitiesFor = (
  situation: Situation,
): readonly MemoryOpportunity[] => {
  const opportunities: MemoryOpportunity[] = [];

  if (situation.corrected) {
    opportunities.push({
      suggestedSubject: 'preference',
      becauseOf: 'correction',
      detail: 'The user corrected the companion; what they corrected may be worth keeping.',
    });
  }
  if (situation.statedFeeling !== null && situation.distressed) {
    opportunities.push({
      suggestedSubject: 'temporary',
      becauseOf: situation.statedFeeling.dimension,
      detail: 'A difficult feeling was stated outright.',
    });
  }
  if (situation.exploring && situation.servingGoals.length === 0) {
    opportunities.push({
      suggestedSubject: 'goal',
      becauseOf: 'reflection',
      detail: 'The user is working something out and no goal covers it.',
    });
  }

  return opportunities;
};

/**
 * How far ahead this plan reaches.
 *
 * Three horizons today and the vocabulary already admits more. Multi-step
 * projects and reminders arrive as new rules producing `ongoing`, and as extra
 * fields on the plan — not as a different engine.
 */
export const horizonFor = (situation: Situation, followUp: FollowUp | null): PlanHorizon => {
  if (situation.planInProgress || situation.servingGoals.length > 0) return 'ongoing';
  if (followUp !== null && followUp.when !== 'next_turn') return 'this_conversation';
  if (situation.hasHistory) return 'this_conversation';
  return 'this_turn';
};
