import type {
  CognitiveContext,
  Decision,
  DecisionKind,
  ReasonCode,
} from '@nexa/models';
import { isDegraded, primaryIntent } from '@nexa/models';

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
      confidence: 0.9,
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
    alternatives.push('answer', 'acknowledge');

    return {
      kind: 'ask_clarifying_question',
      confidence: 0.55,
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
        confidence: degraded ? 0.6 : 0.85,
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
        confidence: 0.8,
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
        confidence: 0.75,
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
        confidence: 0.8,
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
        confidence: 0.7,
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
    confidence: 0.5,
    reasonCodes: ['ambiguous_intent'],
    alternatives: [],
    groundedIn,
  };
};
