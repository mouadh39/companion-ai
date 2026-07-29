import type { DecisionId } from '@nexa/shared';

/**
 * What the companion decided to do. Never what it decided to *say* — language
 * is generated downstream, from this.
 *
 * The separation is the whole point of having a Decision Engine at all: a model
 * that returns prose has already conflated "what should happen" with "how to
 * phrase it", and neither can then be inspected, tested, or overridden.
 */
export type DecisionKind =
  | 'answer'
  | 'ask_clarifying_question'
  | 'acknowledge'
  | 'stay_silent'
  | 'call_tool'
  | 'remember'
  | 'defer';

/**
 * Stable, enumerated reasons a decision was reached.
 *
 * Deliberately codes rather than prose. Prose cannot be aggregated, and
 * "why does it keep asking me questions?" is a question best answered with a
 * distribution as well as a narrative.
 */
export type ReasonCode =
  | 'direct_question'
  | 'explicit_request'
  | 'low_confidence'
  | 'ambiguous_intent'
  | 'missing_context'
  | 'relevant_memory_found'
  | 'active_goal_related'
  | 'emotional_support_needed'
  | 'user_appears_busy'
  | 'nothing_to_add'
  | 'tool_required'
  | 'degraded_context';

export interface Decision {
  readonly id: DecisionId;
  readonly kind: DecisionKind;
  /** 0–1. Low confidence should make the companion ask rather than assert. */
  readonly confidence: number;
  /** Why. Ordered by contribution, strongest first. Never empty. */
  readonly reasonCodes: readonly ReasonCode[];
  /** What else was viable. Empty when the choice was unambiguous. */
  readonly alternatives: readonly DecisionKind[];
  /** Ids of the memories that influenced this decision, for the audit trail. */
  readonly groundedIn: readonly string[];
}

/**
 * Priority ordering when several decisions compete.
 *
 * Encoded as data rather than as branching so the ordering is testable on its
 * own and can be changed without touching deliberation logic. Lower sorts first.
 */
export const DECISION_PRIORITY: Readonly<Record<DecisionKind, number>> = {
  answer: 0,
  ask_clarifying_question: 1,
  call_tool: 2,
  acknowledge: 3,
  remember: 4,
  defer: 5,
  stay_silent: 6,
};

export const compareDecisionKinds = (a: DecisionKind, b: DecisionKind): number =>
  DECISION_PRIORITY[a] - DECISION_PRIORITY[b];
