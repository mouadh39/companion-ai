import type {
  CognitiveContext,
  Decision,
  DecisionHint,
  DecisionKind,
  ReasonCode,
} from '@nexa/models';
import {
  MIN_ACTIONABLE_HINT_CONFIDENCE,
  confidence,
  isDegraded,
  primaryIntent,
} from '@nexa/models';

/**
 * A decision before an identifier has been assigned to it.
 *
 * The id is deliberately *not* produced here. Generating one would mean calling
 * a UUID function, and that single impurity would cost the property this whole
 * design exists to protect: that the same context always yields the same
 * decision. The turn stamps the id immediately afterwards.
 */
export type DecisionDraft = Omit<Decision, 'id'>;

/**
 * Chooses what the companion should do.
 *
 * **This function is pure.** No I/O, no clock reads, no randomness. Everything
 * time- or entropy-dependent arrives inside `CognitiveContext`, which is
 * sampled once at the start of the turn.
 *
 * That constraint is the most important one in the codebase, and it buys four
 * things that are otherwise expensive or impossible:
 *
 * - reasoning can be snapshot-tested, because the output is a function of the input
 * - any production decision can be replayed offline from its logged context
 * - explainability is structural rather than reconstructed, because the inputs
 *   are captured by construction
 * - there are no flaky tests, because there is nothing to be flaky
 *
 * If deliberation ever appears to need information it does not have, that is a
 * bug in context assembly — never a reason to reach out from here.
 */
/**
 * A hint worth acting on, or null.
 *
 * Two filters, both deliberate. The confidence floor keeps a weak opinion from
 * adding noise to cases that were already uncertain. The `stay_silent`
 * exclusion is the sharper one: an advisor that can silence the companion can
 * make it unresponsive through a single bad model call, and silence is the one
 * outcome the user cannot distinguish from a fault.
 */
const actionableHint = (hint: DecisionHint | null | undefined): DecisionHint | null => {
  // `undefined` is accepted alongside `null` because replay reads contexts that
  // were serialised before this field existed. A pure function that throws on a
  // two-month-old log row would make the replay harness — the main reason for
  // keeping deliberation pure — useless against exactly the history it needs.
  if (hint === null || hint === undefined) return null;
  if (hint.confidence < MIN_ACTIONABLE_HINT_CONFIDENCE) return null;
  if (hint.suggested === 'stay_silent') return null;
  return hint;
};

export const deliberate = (context: CognitiveContext): DecisionDraft => {
  const reasons: ReasonCode[] = [];
  const alternatives: DecisionKind[] = [];

  const intent = primaryIntent(context.perception);
  const intentConfidence = context.perception.intents[0]?.confidence ?? 0;
  const degraded = isDegraded(context.budget);

  const groundedIn = context.retrievedMemories.map((retrieved) => retrieved.memory.id);
  const hasRelevantMemory = context.retrievedMemories.some(
    (retrieved) => retrieved.score >= 0.5,
  );

  // An empty message carries no intent to serve. Silence is a legitimate
  // decision, and treating it as one avoids the reflex to fill every pause.
  if (context.perception.text.trim().length === 0) {
    return {
      kind: 'stay_silent',
      confidence: confidence(0.9),
      reasonCodes: ['nothing_to_add'],
      alternatives: [],
      groundedIn: [],
    };
  }

  // Low-confidence intent means the companion does not yet know what is being
  // asked. Asking is strictly better than answering the wrong question, and
  // `10_Decision_Engine.md` requires exactly this when confidence is low.
  if (intent === 'unknown' || intentConfidence < 0.4) {
    reasons.push(intentConfidence < 0.4 ? 'low_confidence' : 'ambiguous_intent');
    if (degraded) reasons.push('degraded_context');

    // The one place the advisor is consulted: the rules have run out and would
    // otherwise fall back to asking. A hint may only break a tie the rules
    // could not settle — allowing it to override a confident rule would make
    // the rules decorative, and would put an unreplayable judgement on a path
    // that is meant to be reproducible.
    const advised = actionableHint(context.hint);
    if (advised !== null) {
      return {
        kind: advised.suggested,
        // Never inherits the advisor's own confidence. The rules were unsure,
        // and an advisor's certainty is not evidence that they should not have
        // been — so the result stays modest whatever the hint claims.
        confidence: confidence(0.6),
        reasonCodes: [...reasons, ...advised.reasonCodes],
        alternatives: ['ask_clarifying_question'],
        groundedIn,
      };
    }

    alternatives.push('answer', 'acknowledge');

    return {
      kind: 'ask_clarifying_question',
      confidence: confidence(0.55),
      reasonCodes: reasons,
      alternatives,
      groundedIn,
    };
  }

  switch (intent) {
    case 'question':
    case 'request': {
      reasons.push(intent === 'question' ? 'direct_question' : 'explicit_request');
      if (hasRelevantMemory) reasons.push('relevant_memory_found');
      if (context.goals.length > 0) reasons.push('active_goal_related');

      // A degraded context still answers, but says so — the alternative is a
      // thin answer the user has no way to account for.
      if (degraded) {
        reasons.push('degraded_context');
        alternatives.push('ask_clarifying_question');
      }

      return {
        kind: 'answer',
        confidence: confidence(degraded ? 0.6 : 0.85),
        reasonCodes: reasons,
        alternatives,
        groundedIn,
      };
    }

    case 'emotional_support': {
      reasons.push('emotional_support_needed');
      if (hasRelevantMemory) reasons.push('relevant_memory_found');
      alternatives.push('acknowledge');

      return {
        kind: 'answer',
        confidence: confidence(0.8),
        reasonCodes: reasons,
        alternatives,
        groundedIn,
      };
    }

    case 'planning': {
      reasons.push('active_goal_related');
      if (hasRelevantMemory) reasons.push('relevant_memory_found');
      alternatives.push('ask_clarifying_question');

      return {
        kind: 'answer',
        confidence: confidence(0.75),
        reasonCodes: reasons,
        alternatives,
        groundedIn,
      };
    }

    case 'correction': {
      // A correction is worth keeping: it is the user telling the companion
      // something about the world or about themselves that it had wrong.
      reasons.push('explicit_request');
      alternatives.push('answer');

      return {
        kind: 'remember',
        confidence: confidence(0.8),
        reasonCodes: reasons,
        alternatives,
        groundedIn,
      };
    }

    case 'statement':
    case 'casual': {
      reasons.push(hasRelevantMemory ? 'relevant_memory_found' : 'nothing_to_add');
      alternatives.push('answer', 'stay_silent');

      return {
        kind: 'acknowledge',
        confidence: confidence(0.7),
        reasonCodes: reasons,
        alternatives,
        groundedIn,
      };
    }
  }

  // `unknown` is already handled by the low-confidence branch above, so the
  // switch is exhaustive over what remains. This line is what makes adding a
  // new intent a compile error rather than a silent fall-through: the assignment
  // fails the moment `intent` can still be something unhandled.
  const exhaustive: never = intent;
  void exhaustive;

  return {
    kind: 'ask_clarifying_question',
    confidence: confidence(0.5),
    reasonCodes: ['ambiguous_intent'],
    alternatives: [],
    groundedIn,
  };
};
