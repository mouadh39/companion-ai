import type {
  ConversationPlan,
  DecisionHint,
  DecisionKind,
  ReasonCode,
  Strategy,
} from '@nexa/models';
import { MIN_ACTIONABLE_HINT_CONFIDENCE, confidence as asConfidence } from '@nexa/models';

/**
 * The projection down to Core's existing contract.
 *
 * Core's `deliberate()` picks one act from a closed set of seven, on the
 * critical path, and it stays exactly as it is. A plan is wider and answers a
 * different question — so rather than widening `Decision`, planning feeds the
 * seam Core already has for precisely this: `DecisionHint`.
 *
 * That seam was documented as "the escape valve for the day rule-based
 * deliberation stops sufficing", with the expectation that a model would fill
 * it. A pure planner fills it better. The hint is advisory, arrives as an
 * ordinary context field, and is replayable — so deliberation stays a pure
 * function of its input and the input merely got better informed. Nothing about
 * Core changes.
 *
 * ## Advisory, and that is the correct relationship
 *
 * Core consults the hint only where its own rules were unsure, and never lets it
 * override a confident rule. That is right even though this planner is more
 * thorough than the rules it advises: the rules are on the latency path and
 * guaranteed to run, and a companion whose behaviour could be wholly redirected
 * by an optional upstream capability would behave differently depending on
 * whether that capability was composed in.
 */

/**
 * Which act each strategy implies, in Core's narrower vocabulary.
 *
 * Several strategies map to one act — every strategy that asks something first
 * is an `ask_clarifying_question` to Core, whether it is asking to understand,
 * to explore, or to confirm. The collapse is the projection's, not the
 * vocabulary's: the plan keeps the finer distinction, and the caller that wants
 * it reads the plan.
 */
const ACT_FOR: Readonly<Record<Strategy, DecisionKind>> = {
  clarify_first: 'ask_clarifying_question',
  explore_problem: 'ask_clarifying_question',
  reflect_back: 'ask_clarifying_question',
  acknowledge_first: 'acknowledge',
  stay_with_them: 'acknowledge',
  encourage_then_explain: 'answer',
  answer_directly: 'answer',
  teach_stepwise: 'answer',
  offer_options: 'answer',
  defer_to_user: 'defer',
  // Core's `stay_silent` is deliberately *not* used. The hint contract forbids
  // it — an advisor that can silence the companion can make it unresponsive
  // through one bad upstream call, and silence is the one outcome a user cannot
  // tell from a fault. `defer` is the honest neighbour: say little, hand back.
  hold_back: 'defer',
};

/** Plan reason codes that have a counterpart in Core's vocabulary. */
const REASON_FOR: Readonly<Partial<Record<string, ReasonCode>>> = {
  intent_unclear: 'ambiguous_intent',
  intent_clear: 'direct_question',
  user_asked_for_help: 'explicit_request',
  emotion_observed: 'emotional_support_needed',
  memory_supported: 'relevant_memory_found',
  goal_served: 'active_goal_related',
  nothing_to_add: 'nothing_to_add',
  identity_boundary: 'missing_context',
  safety_constraint: 'low_confidence',
  user_is_closing: 'user_appears_busy',
};

/**
 * A hint Core can act on, or null.
 *
 * Returns null below `MIN_ACTIONABLE_HINT_CONFIDENCE` rather than handing over a
 * weak opinion Core would discard anyway. Doing the filtering here means the
 * absence is legible at the point it was decided — a caller can see that
 * planning declined to advise, which reads differently from planning having
 * never run.
 */
export const toDecisionHint = (plan: ConversationPlan, source = 'nexa/planning'): DecisionHint | null => {
  const confidence = plan.uncertainty.confidence;
  if (confidence < MIN_ACTIONABLE_HINT_CONFIDENCE) return null;

  const suggested = ACT_FOR[plan.strategy];
  // Guarding the contract at the boundary rather than trusting the table. A
  // future strategy mapped carelessly to `stay_silent` would otherwise pass
  // straight through the one exclusion Core relies on.
  if (suggested === 'stay_silent') return null;

  const codes = new Set<ReasonCode>();
  for (const reason of plan.rationale) {
    const mapped = REASON_FOR[reason.code];
    if (mapped !== undefined) codes.add(mapped);
  }
  if (plan.constraints.includes('require_clarification_before_acting')) {
    codes.add('missing_context');
  }

  return {
    suggested,
    confidence: asConfidence(confidence),
    source,
    // Sorted so the same plan always yields the same hint, byte for byte.
    reasonCodes: [...codes].sort(),
  };
};

/** The act a plan implies, whatever its confidence. For callers that are not Core. */
export const actFor = (strategy: Strategy): DecisionKind => ACT_FOR[strategy];
