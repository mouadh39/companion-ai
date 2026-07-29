import { describe, expect, it } from 'vitest';
import { deliberate } from '@nexa/core';
import { defaultBudget, defaultPersonality } from '@nexa/models';
import type {
  CognitiveContext,
  ContextBudget,
  IntentCandidate,
  Perception,
  RetrievedMemory,
} from '@nexa/models';
import { trustExternalId } from '@nexa/shared';
import type { CompanionId, MemoryId, TurnId, UserId } from '@nexa/shared';

/**
 * Deliberation is a pure function, and these tests exist to hold it that way.
 *
 * Every case below constructs a context by hand and asserts on the decision.
 * There is no clock, no I/O, no fixture server, and nothing to stub — which is
 * the whole return on making the stage pure.
 */

const context = (overrides: {
  intents?: readonly IntentCandidate[];
  text?: string;
  memories?: readonly RetrievedMemory[];
  goals?: readonly string[];
  budget?: ContextBudget;
}): CognitiveContext => {
  const perception: Perception = {
    text: overrides.text ?? 'How does the anchor system work?',
    intents: overrides.intents ?? [{ kind: 'question', confidence: 0.9 }],
    emotion: null,
    entities: [],
  };

  return {
    turnId: trustExternalId<TurnId>('turn-1'),
    companionId: trustExternalId<CompanionId>('companion-1'),
    userId: trustExternalId<UserId>('user-1'),
    at: '2026-07-29T12:00:00.000Z',
    perception,
    identity: {
      name: 'Nexa',
      coreValues: ['honesty'],
      selfDescription: 'A companion.',
      version: 1,
    },
    personality: defaultPersonality(),
    workingMemory: [],
    retrievedMemories: overrides.memories ?? [],
    goals: overrides.goals ?? [],
    availableTools: [],
    budget: overrides.budget ?? { ...defaultBudget(), omissions: [] },
  };
};

const memory = (score: number): RetrievedMemory => ({
  memory: {
    id: trustExternalId<MemoryId>('mem-1'),
    type: 'semantic',
    content: 'The user is building an AR companion in Unity.',
    createdAt: '2026-07-01T00:00:00.000Z',
    importance: 0.8,
    confidence: 0.9,
    valence: 0.2,
    source: 'conversation',
    tags: [],
    relatedTo: [],
  },
  score,
  signals: {
    semantic: score,
    recency: 0.5,
    importance: 0.8,
    goalRelevance: 0.4,
    emotionalSalience: 0.1,
  },
});

describe('deliberate', () => {
  it('is pure — the same context always yields the same decision', () => {
    const input = context({});

    const first = deliberate(input);
    const second = deliberate(input);

    expect(second).toEqual(first);
  });

  it('answers a confident question', () => {
    const decision = deliberate(context({}));

    expect(decision.kind).toBe('answer');
    expect(decision.reasonCodes).toContain('direct_question');
    expect(decision.confidence).toBeGreaterThan(0.8);
  });

  it('asks rather than guesses when intent confidence is low', () => {
    const decision = deliberate(
      context({ intents: [{ kind: 'question', confidence: 0.2 }] }),
    );

    expect(decision.kind).toBe('ask_clarifying_question');
    expect(decision.reasonCodes).toContain('low_confidence');
    // Answering anyway must remain visible as the road not taken.
    expect(decision.alternatives).toContain('answer');
  });

  it('stays silent on an empty message rather than filling the pause', () => {
    const decision = deliberate(context({ text: '   ' }));

    expect(decision.kind).toBe('stay_silent');
    expect(decision.reasonCodes).toEqual(['nothing_to_add']);
  });

  it('lowers confidence and records the cause when context was degraded', () => {
    const degraded = deliberate(
      context({
        budget: {
          ...defaultBudget(),
          omissions: [{ section: 'retrieved_memories', reason: 'port_timeout' }],
        },
      }),
    );
    const healthy = deliberate(context({}));

    expect(degraded.kind).toBe('answer');
    expect(degraded.reasonCodes).toContain('degraded_context');
    expect(degraded.confidence).toBeLessThan(healthy.confidence);
  });

  it('cites the memories it was grounded in', () => {
    const decision = deliberate(context({ memories: [memory(0.8)] }));

    expect(decision.reasonCodes).toContain('relevant_memory_found');
    expect(decision.groundedIn).toEqual(['mem-1']);
  });

  it('ignores a memory that scored too low to be relevant', () => {
    const decision = deliberate(context({ memories: [memory(0.2)] }));

    expect(decision.reasonCodes).not.toContain('relevant_memory_found');
  });

  it('treats a correction as something to remember', () => {
    const decision = deliberate(
      context({ intents: [{ kind: 'correction', confidence: 0.8 }] }),
    );

    expect(decision.kind).toBe('remember');
  });

  it('acknowledges casual conversation instead of expanding on it', () => {
    const decision = deliberate(
      context({ text: 'hey', intents: [{ kind: 'casual', confidence: 0.7 }] }),
    );

    expect(decision.kind).toBe('acknowledge');
    expect(decision.alternatives).toContain('stay_silent');
  });

  it('always produces at least one reason code', () => {
    const kinds: readonly IntentCandidate[][] = [
      [{ kind: 'question', confidence: 0.9 }],
      [{ kind: 'request', confidence: 0.8 }],
      [{ kind: 'planning', confidence: 0.7 }],
      [{ kind: 'emotional_support', confidence: 0.8 }],
      [{ kind: 'statement', confidence: 0.6 }],
      [{ kind: 'correction', confidence: 0.9 }],
    ];

    for (const intents of kinds) {
      expect(deliberate(context({ intents })).reasonCodes.length).toBeGreaterThan(0);
    }
  });
});
