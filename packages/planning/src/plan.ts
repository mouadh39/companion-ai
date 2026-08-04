import type {
  ConversationPlan,
  ConversationTurn,
  ExpressionProfile,
  Goal,
  IdentityProfile,
  PerceptionOutcome,
  PlanReason,
  TaskPlan,
  RelationshipProfile,
  RetrievalOutcome,
  Timestamp,
} from '@nexa/models';
import type { PlanningConfig } from './config.js';
import { DEFAULT_CONFIG } from './config.js';
import {
  clarificationFor,
  followUpFor,
  horizonFor,
  mannerFor,
  memoryOpportunitiesFor,
  objectivesFor,
} from './compose.js';
import { deriveConstraints, planConfidence } from './constraints.js';
import { select } from './select.js';
import type { Situation } from './situation.js';
import { assess } from './situation.js';
import { policyFor } from './strategies.js';

/**
 * One planning pass: the whole cognitive state in, a plan out.
 *
 * Pure, total, clock-free, model-free and store-free. Identical input produces
 * byte-identical output, which is what lets a turn's reasoning be replayed from
 * its log — and what makes "why did it ask instead of answering?" answerable a
 * year later rather than only while the process that decided it is still
 * running.
 *
 * ## It decides how, never what
 *
 * Nothing this function returns contains a sentence anyone is meant to say. It
 * decides that the turn should ask before acting, lead with the feeling, stay
 * slow, withhold advice, disclose uncertainty. Generation writes the words. A
 * planner that produced phrasing would have conflated the decision with its
 * execution, after which neither can be inspected or changed alone.
 *
 * ## The pipeline
 *
 * 1. **Assess** — reduce every input to a `Situation`, once.
 * 2. **Constrain** — derive what must be honoured, *before* any option is weighed.
 * 3. **Evaluate** — weigh all eleven strategies, keeping every argument.
 * 4. **Select** — highest score among the admissible, tie-broken toward caution.
 * 5. **Compose** — objectives, manner, clarification, follow-up, opportunities.
 *
 * Step 2 preceding step 3 is the load-bearing ordering. A constraint that were
 * merely one input among many could be outvoted by a strong preference for
 * being helpful, and the whole reason constraints exist is that some things must
 * not be traded off against helpfulness.
 */

export interface PlanningRequest {
  /** The instant planned for. Never a clock reading. */
  readonly at: Timestamp;

  /** What perception noticed. Required — a plan with no reading is a guess. */
  readonly perception: PerceptionOutcome;

  /**
   * What retrieval decided should be active.
   *
   * Null when no retrieval ran, which is different from retrieval running and
   * finding nothing. The first is a capability that is absent; the second is a
   * fact about the conversation, and only the second should make the companion
   * more careful about what it claims.
   */
  readonly retrieval?: RetrievalOutcome | null;

  readonly conversation?: readonly ConversationTurn[];
  readonly goals?: readonly Goal[];
  readonly relationship?: RelationshipProfile | null;

  /**
   * How personality composed this turn's manner.
   *
   * Treated as a **ceiling**. Planning may lower initiative, pacing and depth
   * and may never raise them: expression already knows what the relationship has
   * earned, and a planner that could overrule it would be substituting one
   * turn's reading for months of accumulated licence.
   */
  readonly expression?: ExpressionProfile | null;

  /**
   * Nexa's own definition.
   *
   * The source of two constraints rather than decoration: an autonomy principle
   * that resolves conflict by asking, and the uncertainty band that decides
   * whether to say so out loud. Identity is the layer that does not drift, and
   * "admit when you are unsure" belongs there rather than in a planner's table.
   */
  readonly identity?: IdentityProfile | null;

  /** A plan already in progress, for continuity. Never revised here. */
  readonly plan?: TaskPlan | null;

  readonly config?: PlanningConfig;
}

export const plan = (request: PlanningRequest): ConversationPlan => {
  const config = request.config ?? DEFAULT_CONFIG;

  // ── 1. assess ──────────────────────────────────────────────────────────
  const situation = assess({
    at: request.at,
    perception: request.perception,
    retrieval: request.retrieval ?? null,
    conversation: request.conversation ?? [],
    goals: request.goals ?? [],
    relationship: request.relationship ?? null,
    expression: request.expression ?? null,
    identity: request.identity ?? null,
    plan: request.plan ?? null,
    minObservationConfidence: config.minObservationConfidence,
    relevantRetrievalScore: config.relevantRetrievalScore,
  });

  // ── 2. constrain ───────────────────────────────────────────────────────
  const derived = deriveConstraints(situation, request.identity ?? null, config.clarityFloor);

  // ── 3 & 4. evaluate, then select ───────────────────────────────────────
  const selection = select(situation, derived.constraints);
  const chosen = policyFor(selection.chosen);

  // ── 5. compose ─────────────────────────────────────────────────────────
  const manner = mannerFor(selection.chosen, situation, derived.constraints, config);
  const objectives = objectivesFor(selection.chosen, situation, config);
  const clarification = clarificationFor(situation, derived.constraints, config);
  const followUp = followUpFor(selection.chosen, situation);
  const opportunities = memoryOpportunitiesFor(situation);

  return {
    primaryObjective: objectives.primary,
    secondaryObjectives: objectives.secondary,

    strategy: selection.chosen,
    considered: selection.evaluations,

    clarification,

    initiative: manner.initiative,
    pacing: manner.pacing,
    explanationDepth: manner.explanationDepth,

    adviceStance: chosen.adviceStance,
    emotionalHandling: emotionalHandlingFor(situation, chosen.emotionalHandling),
    uncertainty: derived.uncertainty,
    constraints: derived.constraints,

    groundedIn: situation.groundedIn,
    informedBy: situation.informedBy,
    servingGoals: situation.servingGoals,

    followUp,
    memoryOpportunities: opportunities,

    horizon: horizonFor(situation, followUp),
    rationale: explain(situation, derived.reasons, selection, manner, followUp, opportunities),
    at: request.at,
  };
};

/**
 * What to do about the emotional register, tempered by how firmly it was read.
 *
 * The strategy proposes and the evidence disposes. A strategy that would lead
 * with the feeling must not do so on a feeling nobody stated — so an inferred
 * reading downgrades to `do_not_presume`, which tells generation that something
 * was noticed and that acting on it would be presuming.
 *
 * This is where perception's observed/possible distinction finally cashes out in
 * behaviour, several layers from where it was drawn.
 */
const emotionalHandlingFor = (
  situation: Situation,
  proposed: ConversationPlan['emotionalHandling'],
): ConversationPlan['emotionalHandling'] => {
  if (situation.strongestFeeling === null) return 'none';
  if (situation.statedFeeling !== null) return proposed;
  return proposed === 'none' ? 'none' : 'do_not_presume';
};

/**
 * The audit trail.
 *
 * Assembled from what actually happened rather than narrated afterwards: the
 * constraints that fired, the strategy that won and by how much, the one that
 * nearly won, and what got capped. "Why this and not that" is answerable from
 * `considered` in full; this is the readable summary of it.
 */
const explain = (
  situation: Situation,
  constraintReasons: readonly PlanReason[],
  selection: ReturnType<typeof select>,
  manner: ReturnType<typeof mannerFor>,
  followUp: ConversationPlan['followUp'],
  opportunities: ConversationPlan['memoryOpportunities'],
): readonly PlanReason[] => {
  const reasons: PlanReason[] = [];

  reasons.push({
    code: situation.clarity >= 0.6 ? 'intent_clear' : 'intent_unclear',
    detail: `Clarity read at ${situation.clarity.toFixed(2)}; plan confidence ${planConfidence(situation).toFixed(2)}.`,
  });

  if (situation.statedFeeling !== null) {
    reasons.push({
      code: 'emotion_observed',
      detail: `The user stated '${situation.statedFeeling.dimension}'.`,
    });
  } else if (situation.strongestFeeling !== null) {
    reasons.push({
      code: 'emotion_possible_only',
      detail: `'${situation.strongestFeeling.dimension}' was inferred; not acted on as fact.`,
    });
  }

  if (situation.askedForHelp) {
    reasons.push({ code: 'user_asked_for_help', detail: 'Help was asked for.' });
  }
  if (situation.exploring) {
    reasons.push({ code: 'user_is_exploring', detail: 'The user is working something out.' });
  }
  if (situation.learning) {
    reasons.push({ code: 'user_is_learning', detail: 'The user is trying to understand.' });
  }
  if (situation.closing) {
    reasons.push({ code: 'user_is_closing', detail: 'The user is ending the exchange.' });
  }
  if (situation.silent) {
    reasons.push({ code: 'nothing_to_add', detail: 'Nothing was said.' });
  }

  if (situation.wellGrounded) {
    reasons.push({
      code: 'memory_supported',
      detail: `${situation.groundedIn.length} memory(ies) and ${situation.informedBy.length} insight(s) were active.`,
    });
  }
  if (situation.servingGoals.length > 0) {
    reasons.push({
      code: 'goal_served',
      detail: `${situation.servingGoals.length} active goal(s) in view.`,
    });
  }
  if (situation.planInProgress) {
    reasons.push({ code: 'continuity_preserved', detail: 'A plan is already under way.' });
  }
  if (situation.sharedUnderstanding >= 0.6) {
    reasons.push({
      code: 'relationship_permits',
      detail: `Shared understanding at ${situation.sharedUnderstanding.toFixed(2)}.`,
    });
  } else if (situation.sharedUnderstanding > 0) {
    reasons.push({
      code: 'relationship_restrains',
      detail: `Shared understanding is only ${situation.sharedUnderstanding.toFixed(2)}.`,
    });
  }

  reasons.push(...constraintReasons);

  const chosen = selection.evaluations.find(
    (evaluation) => evaluation.strategy === selection.chosen,
  );
  reasons.push({
    code: 'strategy_selected',
    detail: `'${selection.chosen}' scored ${chosen?.score.toFixed(2) ?? '0.00'} and was admissible.`,
  });

  if (selection.runnerUp !== null) {
    const runnerUp = selection.evaluations.find(
      (evaluation) => evaluation.strategy === selection.runnerUp,
    );
    reasons.push({
      code: 'strategy_runner_up',
      detail: `'${selection.runnerUp}' was next at ${runnerUp?.score.toFixed(2) ?? '0.00'}.`,
    });
  }

  for (const evaluation of selection.evaluations) {
    if (evaluation.admissible) continue;
    reasons.push({
      code: 'strategy_blocked',
      detail: `'${evaluation.strategy}' was ruled out by ${evaluation.blockedBy
        .map((block) => block.constraint)
        .join(', ')}.`,
    });
  }

  if (manner.capped) {
    reasons.push({
      code: 'expression_capped',
      detail: `Manner lowered to initiative '${manner.initiative}', pacing '${manner.pacing}', depth '${manner.explanationDepth}'.`,
    });
  }
  if (followUp !== null) {
    reasons.push({ code: 'follow_up_recommended', detail: followUp.detail });
  }
  for (const opportunity of opportunities) {
    reasons.push({ code: 'memory_opportunity_noted', detail: opportunity.detail });
  }

  return reasons;
};
