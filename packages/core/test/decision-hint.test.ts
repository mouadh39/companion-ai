import { describe, expect, it } from 'vitest';
import { deliberate } from '@nexa/core';
import {
  MIN_ACTIONABLE_HINT_CONFIDENCE,
  confidence,
  defaultBudget,
  defaultPersonality,
  timestamp,
} from '@nexa/models';
import type {
  CognitiveContext,
  DecisionHint,
  DecisionKind,
  IntentCandidate,
} from '@nexa/models';
import { trustExternalId } from '@nexa/shared';
import type { CompanionId, TurnId, UserId } from '@nexa/shared';
import { testIdentity } from './fixtures.js';

/**
 * The advisory boundary.
 *
 * `DecisionHint` is the escape valve for when rule-based deliberation stops
 * sufficing, and its whole value depends on staying advisory. A hint that could
 * override a confident rule would make the rules decorative and would put an
 * unreplayable judgement on a path meant to be reproducible. These tests hold
 * that line.
 */

const hint = (suggested: DecisionKind, at: number, source = 'test-advisor'): DecisionHint => ({
  suggested,
  confidence: confidence(at),
  source,
  reasonCodes: ['missing_context'],
});

const context = (options: {
  intents: readonly IntentCandidate[];
  hint?: DecisionHint | null;
}): CognitiveContext => ({
  turnId: trustExternalId<TurnId>('turn-1'),
  companionId: trustExternalId<CompanionId>('companion-1'),
  userId: trustExternalId<UserId>('user-1'),
  at: timestamp('2026-07-30T12:00:00.000Z'),
  perception: {
    text: 'the thing from before',
    intents: options.intents,
    entities: [],
    emotion: null,
  },
  identity: testIdentity(),
  expression: null,
  personality: defaultPersonality(),
  workingMemory: [],
  retrievedMemories: [],
  goals: [],
  availableTools: [],
  emotion: null,
  relationship: null,
  world: null,
  plan: null,
  hint: options.hint ?? null,
  budget: { ...defaultBudget(), omissions: [] },
});

/** Intent the rules cannot settle — the only case a hint is consulted in. */
const unsure: readonly IntentCandidate[] = [
  { kind: 'unknown', confidence: confidence(0.2) },
];

/** Intent the rules settle confidently. */
const clear: readonly IntentCandidate[] = [
  { kind: 'question', confidence: confidence(0.9) },
];

describe('deliberation with a hint', () => {
  it('asks, as before, when no advisor is composed in', () => {
    expect(deliberate(context({ intents: unsure })).kind).toBe('ask_clarifying_question');
  });

  it('follows a confident hint where its own rules were unsure', () => {
    const decision = deliberate(context({ intents: unsure, hint: hint('answer', 0.9) }));

    expect(decision.kind).toBe('answer');
    // The rules' own reasoning survives alongside the advisor's.
    expect(decision.reasonCodes).toContain('low_confidence');
    expect(decision.reasonCodes).toContain('missing_context');
    // Asking remains on the record as the road not taken.
    expect(decision.alternatives).toContain('ask_clarifying_question');
  });

  /**
   * The rules were unsure. An advisor's certainty is not evidence that they
   * should not have been, so the decision stays modest whatever the hint claims.
   */
  it('does not inherit the advisor’s confidence', () => {
    const decision = deliberate(context({ intents: unsure, hint: hint('answer', 0.99) }));

    expect(decision.confidence).toBeLessThan(0.7);
  });

  it('ignores a hint below the actionable threshold', () => {
    const weak = MIN_ACTIONABLE_HINT_CONFIDENCE - 0.01;
    const decision = deliberate(context({ intents: unsure, hint: hint('answer', weak) }));

    expect(decision.kind).toBe('ask_clarifying_question');
  });

  it('acts on a hint exactly at the threshold', () => {
    const decision = deliberate(
      context({ intents: unsure, hint: hint('answer', MIN_ACTIONABLE_HINT_CONFIDENCE) }),
    );

    expect(decision.kind).toBe('answer');
  });

  /**
   * The line that matters most. If a hint could redirect a decision the rules
   * reached confidently, the rules would be decorative and every decision would
   * become a model output wearing a deterministic costume.
   */
  it('never overrides a rule that was confident', () => {
    const decision = deliberate(
      context({ intents: clear, hint: hint('stay_silent', 0.99) }),
    );

    expect(decision.kind).toBe('answer');
  });

  /**
   * An advisor that can silence the companion can make it unresponsive through
   * one bad model call, and silence is the single outcome a user cannot
   * distinguish from a fault.
   */
  it('refuses a hint that would silence the companion', () => {
    const decision = deliberate(
      context({ intents: unsure, hint: hint('stay_silent', 0.99) }),
    );

    expect(decision.kind).toBe('ask_clarifying_question');
  });

  it('stays a pure function of its input', () => {
    const input = context({ intents: unsure, hint: hint('acknowledge', 0.8) });

    expect(deliberate(input)).toEqual(deliberate(input));
  });

  /**
   * Replay reads contexts serialised before this field existed. A pure function
   * that threw on an old log row would make the replay harness useless against
   * exactly the history it exists to re-run.
   */
  it('tolerates a context stored before hints existed', () => {
    const legacy = context({ intents: unsure });
    const { hint: _dropped, ...withoutHint } = legacy;

    expect(() => deliberate(withoutHint as CognitiveContext)).not.toThrow();
    expect(deliberate(withoutHint as CognitiveContext).kind).toBe('ask_clarifying_question');
  });
});
