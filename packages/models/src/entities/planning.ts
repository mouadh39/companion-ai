import type { GoalId, InsightId, MemoryId } from '@nexa/shared';
import type { DetailLevel, InitiativeLevel, Pacing } from './expression.js';
import type { MemorySubject } from './memory-formation.js';
import type { ObservationDimension } from './observation.js';
import type { ConfidenceScore } from '../value-objects/score.js';
import type { Timestamp } from '../value-objects/timestamp.js';

/**
 * The vocabulary of *deciding how to proceed*.
 *
 * Identity, personality, relationship, memory, reflection, retrieval and
 * perception all feed one question: given everything the companion now knows,
 * how should this conversation go? A `ConversationPlan` is the answer, and it is
 * the last cognitive artefact before generation turns it into language.
 *
 * ## It decides how, never what
 *
 * Nothing here contains a sentence anyone is meant to say. A plan says *ask
 * before answering*, *acknowledge the feeling before the content*, *do not offer
 * advice unless it is asked for*, *say plainly that you are unsure*. Choosing
 * the words is generation's job, and a plan that included them would have
 * conflated the decision with its execution — after which neither can be
 * inspected, tested, or overridden independently.
 *
 * ## It is not `Decision`
 *
 * `Decision` in `decision.ts` is Core's existing contract: one act, chosen on the
 * critical path, from a closed set of seven. It stays exactly as it is. A plan is
 * wider — objectives, strategy, pacing, safety, follow-up — and answers a
 * different question. The two are bridged rather than merged: a plan projects to
 * a `DecisionHint`, which is the seam Core already has for exactly this.
 *
 * ## Built for horizons it does not yet reach
 *
 * Today every plan is `this_turn` or `this_conversation`. Multi-step projects,
 * reminders and proactive assistance are `PlanHorizon` members and an
 * `objectives` list that is already plural — so adding them is new rules
 * producing existing shapes, not a new model.
 */

/**
 * What the turn is trying to achieve.
 *
 * Objectives, not actions. "Unblock the user" is a thing to accomplish; "ask a
 * clarifying question" is a way of accomplishing it, and conflating the two is
 * how a plan becomes a script. A plan carries one primary objective and any
 * number of secondary ones, because a turn that helps someone *and* confirms it
 * understood them is doing two things on purpose.
 */
export type Objective =
  /** Find out what is actually being asked. */
  | 'understand_the_request'
  /** Give the answer that was asked for. */
  | 'answer_the_question'
  /** Get the user moving again on something they are stuck on. */
  | 'unblock_the_user'
  /** Be alongside someone having a hard time. Not the same as fixing it. */
  | 'support_the_user'
  /** Work the problem together rather than handing over a conclusion. */
  | 'explore_together'
  /** Check that what the companion understood is what was meant. */
  | 'confirm_understanding'
  /** Help them learn the thing rather than receive the answer. */
  | 'build_understanding'
  /** Give the user back the steering. */
  | 'hand_back_control'
  /** Keep the thread of a longer conversation or project intact. */
  | 'preserve_continuity'
  /** Notice something worth keeping. Never writes it. */
  | 'record_something_worth_keeping';

export const OBJECTIVES = [
  'understand_the_request',
  'answer_the_question',
  'unblock_the_user',
  'support_the_user',
  'explore_together',
  'confirm_understanding',
  'build_understanding',
  'hand_back_control',
  'preserve_continuity',
  'record_something_worth_keeping',
] as const satisfies readonly Objective[];

/**
 * How the conversation should proceed.
 *
 * A closed set, because each is a genuinely different shape of turn and each
 * needs its own preconditions. An open-ended "strategy" string would be a free
 * text field that generation would have to interpret, which is the same as
 * having no plan at all.
 *
 * The order here is also the tie-break order — see `STRATEGY_PRIORITY`.
 */
export type Strategy =
  /** Ask before proceeding. The default when anything material is unclear. */
  | 'clarify_first'
  /** Respond to the feeling before the content. */
  | 'acknowledge_first'
  /** Be present without advising. For when help is not what is wanted. */
  | 'stay_with_them'
  /** Draw the problem out with questions rather than guessing at it. */
  | 'explore_problem'
  /** Affirm what is already working, then help. */
  | 'encourage_then_explain'
  /** Answer or explain now. */
  | 'answer_directly'
  /** Break it down and check understanding as you go. */
  | 'teach_stepwise'
  /** Present alternatives rather than one recommendation. */
  | 'offer_options'
  /** Say back what was understood, to confirm it. */
  | 'reflect_back'
  /** Hand the choice over. For boundaries, and for when it is not the companion's call. */
  | 'defer_to_user'
  /** Say little. For when the user is closing, busy, or did not ask. */
  | 'hold_back';

export const STRATEGIES = [
  'clarify_first',
  'acknowledge_first',
  'stay_with_them',
  'explore_problem',
  'encourage_then_explain',
  'answer_directly',
  'teach_stepwise',
  'offer_options',
  'reflect_back',
  'defer_to_user',
  'hold_back',
] as const satisfies readonly Strategy[];

/**
 * The deterministic tie-break when two strategies score the same.
 *
 * Ordered by how little the companion presumes. Asking comes before answering;
 * being present comes before advising; handing control back comes before taking
 * it. So a tie always resolves toward the more careful turn — which is the
 * design principle "prefer asking over assuming" made mechanical rather than
 * left to whichever branch happened to run first.
 */
export const STRATEGY_PRIORITY: Readonly<Record<Strategy, number>> = {
  clarify_first: 0,
  acknowledge_first: 1,
  stay_with_them: 2,
  explore_problem: 3,
  reflect_back: 4,
  defer_to_user: 5,
  encourage_then_explain: 6,
  offer_options: 7,
  teach_stepwise: 8,
  answer_directly: 9,
  hold_back: 10,
};

/**
 * A safety or care requirement the turn must honour.
 *
 * Derived before any strategy is considered, and binding on all of them. That
 * ordering is the point: a constraint that were merely one input among many
 * could be outvoted by a strong preference for answering, and the whole reason
 * these exist is that some things must not be traded off.
 */
export type PlanConstraint =
  /** Do not act on an assumption. Ask. */
  | 'require_clarification_before_acting'
  /** Say out loud how sure the companion is. */
  | 'disclose_uncertainty'
  /** Do not offer advice that was not asked for. */
  | 'no_advice_unless_asked'
  /** Do not state more than the evidence supports. */
  | 'avoid_overclaiming'
  /** The user's judgement outranks the companion's here. */
  | 'defer_to_user_judgement'
  /** Take it slower than usual. */
  | 'slow_down'
  /** Fewer moving parts than usual. */
  | 'simplify'
  /** Anything drawn from reflection must be voiced as a guess, not a fact. */
  | 'do_not_assert_from_inference'
  /** A stated boundary applies to this turn. */
  | 'respect_stated_boundary'
  /** Do not propose anything that cannot be undone. */
  | 'no_irreversible_suggestions';

export const PLAN_CONSTRAINTS = [
  'require_clarification_before_acting',
  'disclose_uncertainty',
  'no_advice_unless_asked',
  'avoid_overclaiming',
  'defer_to_user_judgement',
  'slow_down',
  'simplify',
  'do_not_assert_from_inference',
  'respect_stated_boundary',
  'no_irreversible_suggestions',
] as const satisfies readonly PlanConstraint[];

/** Whether help should be offered, withheld, or given only when asked for. */
export type AdviceStance = 'offer' | 'on_request' | 'withhold';

export const ADVICE_STANCES = [
  'offer',
  'on_request',
  'withhold',
] as const satisfies readonly AdviceStance[];

/** What the turn should do about the emotional register it was read in. */
export type EmotionalHandling =
  /** Nothing was read. Proceed normally. */
  | 'none'
  /** Note it lightly and carry on with the substance. */
  | 'acknowledge_briefly'
  /** Deal with the feeling before the content. */
  | 'lead_with_it'
  /** Stay with it. Do not move to solving. */
  | 'hold_space'
  /**
   * Something was read but not firmly enough to act on.
   *
   * The stance that keeps a guess from becoming a claim. A companion that
   * responds to a mood it inferred at 0.4 confidence will eventually console
   * someone who was perfectly cheerful, and being wrong about that is worse than
   * saying nothing about it.
   */
  | 'do_not_presume';

export const EMOTIONAL_HANDLINGS = [
  'none',
  'acknowledge_briefly',
  'lead_with_it',
  'hold_space',
  'do_not_presume',
] as const satisfies readonly EmotionalHandling[];

/** How the companion should carry its own uncertainty this turn. */
export interface UncertaintyHandling {
  /** How sure the plan is that it read the situation correctly. */
  readonly confidence: ConfidenceScore;
  /** Whether to say so unprompted. Comes from identity's own stances. */
  readonly disclose: boolean;
  /** Whether the user's judgement should outrank the companion's. */
  readonly defer: boolean;
  /** The identity band this fell into, for the audit trail. */
  readonly band: string;
}

/** Why something needs to be asked before the turn can proceed. */
export type ClarificationReason =
  | 'intent_unclear'
  | 'referent_unclear'
  | 'scope_unclear'
  | 'conflicting_signals'
  | 'missing_context'
  | 'boundary_touched';

export const CLARIFICATION_REASONS = [
  'intent_unclear',
  'referent_unclear',
  'scope_unclear',
  'conflicting_signals',
  'missing_context',
  'boundary_touched',
] as const satisfies readonly ClarificationReason[];

/**
 * Something that must be established before the companion can safely proceed.
 *
 * Carries *why*, never the question itself. Writing the question is generation's
 * job — and a plan that supplied one would be a plan containing a sentence,
 * which is the line this whole package is drawn around.
 */
export interface ClarificationNeed {
  readonly reason: ClarificationReason;
  /** Whether the turn can proceed at all without it. */
  readonly blocking: boolean;
  /** What is unclear, as a reference rather than as prose. */
  readonly about: readonly string[];
  readonly detail: string;
}

/** When the companion should come back to something. */
export type FollowUpKind =
  | 'check_understanding'
  | 'revisit_goal'
  | 'ask_how_it_went'
  | 'return_to_deferred_topic';

export const FOLLOW_UP_KINDS = [
  'check_understanding',
  'revisit_goal',
  'ask_how_it_went',
  'return_to_deferred_topic',
] as const satisfies readonly FollowUpKind[];

export type FollowUpWhen = 'next_turn' | 'this_conversation' | 'later';

export const FOLLOW_UP_WHENS = [
  'next_turn',
  'this_conversation',
  'later',
] as const satisfies readonly FollowUpWhen[];

/**
 * A recommendation to come back to something.
 *
 * A *recommendation*, and the word is load-bearing. Planning schedules nothing:
 * there is no timer, no job, no reminder row. It records that returning to this
 * would be worth doing, and whoever owns the next turn decides whether to.
 */
export interface FollowUp {
  readonly kind: FollowUpKind;
  readonly when: FollowUpWhen;
  /** A goal or memory this concerns, when it concerns one. */
  readonly subject: GoalId | MemoryId | null;
  readonly detail: string;
}

/**
 * Something in this turn that memory might want.
 *
 * A pointer, never a write. Planning noticing that the user just stated a
 * preference is useful; planning storing it would put a second, unreviewed
 * writer into a subsystem with its own formation rules, floors and permission
 * checks. `@nexa/memory` decides what earns a place — this only points.
 */
export interface MemoryOpportunity {
  readonly suggestedSubject: MemorySubject;
  /** The observation that prompted it, so the suggestion is checkable. */
  readonly becauseOf: ObservationDimension;
  readonly detail: string;
}

/** How far ahead a plan reaches. */
export type PlanHorizon =
  /** This exchange only. */
  | 'this_turn'
  /** Shapes the rest of this conversation. */
  | 'this_conversation'
  /** Serves something that outlives the conversation. */
  | 'ongoing';

export const PLAN_HORIZONS = [
  'this_turn',
  'this_conversation',
  'ongoing',
] as const satisfies readonly PlanHorizon[];

/** Why a plan reads as it does. */
export type PlanReasonCode =
  | 'intent_clear'
  | 'intent_unclear'
  | 'emotion_observed'
  | 'emotion_possible_only'
  | 'user_asked_for_help'
  | 'user_is_exploring'
  | 'user_is_learning'
  | 'user_is_closing'
  | 'goal_served'
  | 'continuity_preserved'
  | 'memory_supported'
  | 'inference_hedged'
  | 'relationship_permits'
  | 'relationship_restrains'
  | 'identity_boundary'
  | 'identity_uncertainty_stance'
  | 'safety_constraint'
  | 'strategy_blocked'
  | 'strategy_selected'
  | 'strategy_runner_up'
  | 'expression_capped'
  | 'follow_up_recommended'
  | 'memory_opportunity_noted'
  | 'nothing_to_add';

export const PLAN_REASON_CODES = [
  'intent_clear',
  'intent_unclear',
  'emotion_observed',
  'emotion_possible_only',
  'user_asked_for_help',
  'user_is_exploring',
  'user_is_learning',
  'user_is_closing',
  'goal_served',
  'continuity_preserved',
  'memory_supported',
  'inference_hedged',
  'relationship_permits',
  'relationship_restrains',
  'identity_boundary',
  'identity_uncertainty_stance',
  'safety_constraint',
  'strategy_blocked',
  'strategy_selected',
  'strategy_runner_up',
  'expression_capped',
  'follow_up_recommended',
  'memory_opportunity_noted',
  'nothing_to_add',
] as const satisfies readonly PlanReasonCode[];

export interface PlanReason {
  readonly code: PlanReasonCode;
  readonly detail: string;
}

/**
 * One argument for or against a strategy.
 *
 * The unit of explainability here, and the reason the engine scores rather than
 * branches. A tree of conditionals can say which branch was taken; it cannot say
 * what nearly happened instead. A list of named, signed, weighted considerations
 * can answer both — "why this?" is the positive ones, and "why not that?" is the
 * losing strategy's own list, kept rather than discarded.
 */
export interface Consideration {
  readonly code: PlanReasonCode;
  /** Positive argues for the strategy, negative against. Never zero. */
  readonly weight: number;
  readonly detail: string;
}

/** Why a strategy was not available at all, whatever it scored. */
export interface StrategyBlock {
  readonly constraint: PlanConstraint;
  readonly detail: string;
}

/**
 * One strategy, weighed.
 *
 * Every strategy is evaluated and every evaluation is kept, including the ones
 * that lost and the ones that were never admissible. That is what makes "why not
 * option B?" answerable without re-running anything — and it is cheap, because
 * the set is closed and small.
 */
export interface StrategyEvaluation {
  readonly strategy: Strategy;
  /** False when a constraint or precondition ruled it out. */
  readonly admissible: boolean;
  readonly blockedBy: readonly StrategyBlock[];
  readonly considerations: readonly Consideration[];
  /** Sum of the considerations. Meaningless for an inadmissible strategy. */
  readonly score: number;
  /** 1-based, among admissible strategies. Null when inadmissible. */
  readonly rank: number | null;
}

/**
 * How the conversation should proceed.
 *
 * Everything generation needs to shape a turn, and nothing it needs to write
 * one. The fields divide into three groups: what the turn is *for* (objectives,
 * strategy), how it should be *carried* (initiative, pacing, depth, advice,
 * emotion, uncertainty), and what must be *honoured* (constraints,
 * clarification). The rest is the audit trail.
 */
export interface ConversationPlan {
  readonly primaryObjective: Objective;
  readonly secondaryObjectives: readonly Objective[];

  readonly strategy: Strategy;
  /** Every strategy, weighed and ranked. Includes the ones that lost. */
  readonly considered: readonly StrategyEvaluation[];

  /** Null when nothing needs establishing first. */
  readonly clarification: ClarificationNeed | null;

  /**
   * How much the companion should lead, and at what pace and depth.
   *
   * These reuse the expression vocabulary deliberately. Two scales for "how
   * forward should it be" would need a mapping, and the mapping is where a
   * companion becomes pushier than anyone decided it should be. Planning may
   * only ever move these *down* from what expression proposed — it can be more
   * careful than the relationship has earned, never less.
   */
  readonly initiative: InitiativeLevel;
  readonly pacing: Pacing;
  readonly explanationDepth: DetailLevel;

  readonly adviceStance: AdviceStance;
  readonly emotionalHandling: EmotionalHandling;
  readonly uncertainty: UncertaintyHandling;
  readonly constraints: readonly PlanConstraint[];

  /** Memories that shaped this plan. The citations behind "why that?". */
  readonly groundedIn: readonly MemoryId[];
  /** Insights that shaped it. Kept apart from memories — one is inferred. */
  readonly informedBy: readonly InsightId[];
  readonly servingGoals: readonly GoalId[];

  readonly followUp: FollowUp | null;
  readonly memoryOpportunities: readonly MemoryOpportunity[];

  readonly horizon: PlanHorizon;
  readonly rationale: readonly PlanReason[];
  /** The moment planned for. Never a clock reading. */
  readonly at: Timestamp;
}
