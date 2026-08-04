import type { DecisionId, MemoryId } from '@nexa/shared';
import type { ConfidenceScore } from '../value-objects/score.js';

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

export const DECISION_KINDS = [
  'answer',
  'ask_clarifying_question',
  'acknowledge',
  'stay_silent',
  'call_tool',
  'remember',
  'defer',
] as const satisfies readonly DecisionKind[];

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

export const REASON_CODES = [
  'direct_question',
  'explicit_request',
  'low_confidence',
  'ambiguous_intent',
  'missing_context',
  'relevant_memory_found',
  'active_goal_related',
  'emotional_support_needed',
  'user_appears_busy',
  'nothing_to_add',
  'tool_required',
  'degraded_context',
] as const satisfies readonly ReasonCode[];

export interface Decision {
  readonly id: DecisionId;
  readonly kind: DecisionKind;
  /** Low confidence should make the companion ask rather than assert. */
  readonly confidence: ConfidenceScore;
  /** Why. Ordered by contribution, strongest first. Never empty. */
  readonly reasonCodes: readonly ReasonCode[];
  /** What else was viable. Empty when the choice was unambiguous. */
  readonly alternatives: readonly DecisionKind[];
  /**
   * The memories that influenced this decision, for the audit trail.
   *
   * Typed as `MemoryId` rather than `string`: these are the citations behind
   * "why did you bring that up?", and an untyped id here is one that can be
   * populated with the wrong kind of identifier and never noticed.
   */
  readonly groundedIn: readonly MemoryId[];
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

/**
 * An advisory opinion on what the companion should do, formed *before*
 * deliberation runs.
 *
 * This is the escape valve for the day rule-based deliberation stops sufficing.
 * The obvious fix — call a model inside `deliberate()` — would destroy purity
 * and every property built on it: replay, snapshot tests, and explainability
 * that is structural rather than reconstructed.
 *
 * So the model call happens during *context assembly*, and its opinion arrives
 * as an ordinary field on `CognitiveContext`. Deliberation stays a pure
 * function of its input; the input merely got smarter. Replay still works,
 * because you replay against the recorded hint rather than re-asking the model.
 *
 * **Advisory, never binding.** Deliberation consults it only where its own
 * rules are unsure — see `MIN_ACTIONABLE_HINT_CONFIDENCE`. A hint that could
 * override a confident rule would make the rules decorative.
 */
export interface DecisionHint {
  readonly suggested: DecisionKind;
  /** How sure the advisor is. Below the threshold the hint is ignored outright. */
  readonly confidence: ConfidenceScore;
  /**
   * What produced it — a model id, a classifier name, a heuristic.
   *
   * Recorded because a hint that changed a decision must be attributable. When
   * the advisor is swapped, every decision it influenced is identifiable.
   */
  readonly source: string;
  /** Codes the advisor offers, merged into the decision's own reasons. */
  readonly reasonCodes: readonly ReasonCode[];
}

/**
 * Below this, a hint is not acted on at all.
 *
 * Set high deliberately. A hint only ever breaks a tie the rules could not
 * settle, so a weak one adds noise to exactly the cases that were already
 * uncertain — and "the companion guessed, twice" is worse than "the companion
 * asked".
 */
export const MIN_ACTIONABLE_HINT_CONFIDENCE = 0.7;
