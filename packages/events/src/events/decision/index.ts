import type { ConfidenceScore, DecisionId, DecisionKind, MemoryId, ReasonCode } from '@nexa/models';
import type { EventEnvelope } from '../../interfaces/envelope.js';
import { defineEvent } from '../../interfaces/envelope.js';

/**
 * What the companion decided, and why.
 *
 * The single most valuable event in the catalogue for explainability. It
 * carries the reason codes and the alternatives, so "why did it ask that
 * instead of answering?" is answerable from the log alone — without replaying
 * the turn and without the Decision Engine having to reconstruct its own
 * reasoning after the fact.
 *
 * `reasonCodes` are stable enumerated strings rather than prose because prose
 * cannot be aggregated, and the useful form of that question is a distribution
 * across thousands of turns as well as a narrative about one.
 */
export interface DecisionMadePayload {
  readonly decisionId: DecisionId;
  readonly kind: DecisionKind;
  readonly confidence: ConfidenceScore;
  readonly reasonCodes: readonly ReasonCode[];
  readonly alternatives: readonly DecisionKind[];
  /** Memories that grounded the decision. Empty when it rested on none. */
  readonly groundedIn?: readonly MemoryId[];
}

export const decisionMade = defineEvent<'nexa.decision.made', DecisionMadePayload>(
  'nexa.decision.made',
  1,
  { source: 'decision' },
);

export type DecisionEvent = EventEnvelope<'nexa.decision.made', DecisionMadePayload>;

export const DECISION_EVENTS = [decisionMade] as const;
