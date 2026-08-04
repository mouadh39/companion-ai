import { describe, expect, it } from 'vitest';
import { retrieve, toRetrievedMemories } from '@nexa/retrieval';
import type { RetrievalRequest } from '@nexa/retrieval';
import {
  at,
  eventOf,
  feeling,
  goalOf,
  idsOf,
  insightOf,
  memoryOf,
  heard,
  relationshipOf,
  turnOf,
  unityWorld,
} from './fixtures.js';

/** A world with something of every kind in it. */
const world = (): RetrievalRequest => ({
  at: at(0),
  ...heard("I'm working on the Unity shader today.", {
    entities: ['Unity'],
    emotion: feeling('frustration'),
  }),
  conversation: [
    turnOf('user', 'The shader compiler keeps failing.', 0),
    turnOf('companion', 'That is usually a precision problem.', 0),
  ],
  memories: [
    ...unityWorld(),
    memoryOf('My name is Sam and I work as a nurse.', 'identity', 400),
    eventOf('We debugged the shader for three hours.', 1),
    memoryOf('I graduated in June.', 'milestone', 700),
    memoryOf('My sister lives in Berlin.', 'relationship', 200),
  ],
  insights: [
    insightOf('The user may currently be overworking.', 'condition', 1),
    insightOf('The user consistently prefers short, direct answers.', 'communication', 30),
    insightOf('The user has a recurring pattern around late nights.', 'habit', 40),
  ],
  goals: [goalOf('ship the Nexa demo'), goalOf('learn Spanish', 0.3)],
  relationship: relationshipOf(),
});

describe('purity', () => {
  it('never mutates what it was given', () => {
    const request = world();
    const snapshot = structuredClone({
      memories: request.memories,
      insights: request.insights,
      goals: request.goals,
      relationship: request.relationship,
      conversation: request.conversation,
    });

    retrieve(request);

    expect({
      memories: request.memories,
      insights: request.insights,
      goals: request.goals,
      relationship: request.relationship,
      conversation: request.conversation,
    }).toStrictEqual(snapshot);
  });

  it('hands back the very objects it was given, never copies', () => {
    // Retrieval creates no knowledge. An item that carried a reconstructed
    // memory would be a second, drifting copy of the user's own record.
    const request = world();
    const outcome = retrieve(request);
    const first = outcome.items.find((item) => item.source === 'memory');

    expect(request.memories).toContain(first?.source === 'memory' ? first.memory : null);
  });

  it('returns a deeply equal result for the same request', () => {
    expect(retrieve(world())).toStrictEqual(retrieve(world()));
  });

  it('does not depend on the order candidates arrived in', () => {
    const forwards = retrieve(world());
    const request = world();
    const backwards = retrieve({
      ...request,
      memories: [...request.memories].reverse(),
      insights: [...request.insights].reverse(),
    });

    expect(idsOf(backwards)).toStrictEqual(idsOf(forwards));
  });

  it('reads no clock — the same world at two moments differs', () => {
    // The proof that time comes from the argument. If a clock were read, these
    // would be identical whatever was passed.
    const now = retrieve(world());
    const later = retrieve({ ...world(), at: at(200) });

    expect(later.items.map((item) => item.signals.recency)).not.toStrictEqual(
      now.items.map((item) => item.signals.recency),
    );
  });

  it('carries the instant it was asked about into the result', () => {
    expect(retrieve({ ...world(), at: at(-3) }).at).toBe(at(-3));
  });
});

describe('replay', () => {
  it('reconstructs the same selection from a logged request', () => {
    // What makes a turn's context reproducible: the same inputs, months later,
    // in a different process, produce the same context.
    const request = world();
    const serialised = JSON.parse(
      JSON.stringify({ ...request, semantic: undefined }),
    ) as RetrievalRequest;

    expect(idsOf(retrieve(serialised))).toStrictEqual(idsOf(retrieve(request)));
  });

  it('produces the same ranks and scores across runs', () => {
    const a = retrieve(world());
    const b = retrieve(world());

    expect(a.items.map((item) => [item.rank, item.score])).toStrictEqual(
      b.items.map((item) => [item.rank, item.score]),
    );
  });

  it('is unaffected by whether vectors happen to be available', () => {
    // Not that the results are the same — they should not be — but that the
    // absence is reported rather than silently changing the answer.
    const without = retrieve(world());
    expect(without.degraded.some((entry) => entry.reason === 'semantic_unavailable')).toBe(
      true,
    );
  });
});

describe('totality', () => {
  const empty: RetrievalRequest = {
    at: at(0),
    ...heard(''),
    conversation: [],
    memories: [],
    insights: [],
    goals: [],
    relationship: null,
  };

  it('handles an empty world without throwing', () => {
    const outcome = retrieve(empty);

    expect(outcome.items).toStrictEqual([]);
    expect(outcome.consideredCount).toBe(0);
    expect(outcome.spend.tokens).toBe(0);
  });

  it('handles a message with nothing in it', () => {
    const outcome = retrieve({
      ...empty,
      ...heard('   '),
      memories: [memoryOf('Unity is my engine.', 'preference', 5)],
    });

    // Nothing was asked, so nothing anchors. Returning the whole store because
    // the message was empty is the failure mode this guards.
    expect(outcome.items).toStrictEqual([]);
  });

  it('handles malformed timestamps without throwing', () => {
    expect(() =>
      retrieve({
        ...empty,
        ...heard('Unity'),
        memories: [memoryOf('Unity is my engine.', 'preference', 5, {
          createdAt: 'not-a-date' as never,
        })],
      }),
    ).not.toThrow();
  });

  it('handles an empty memory without offering it', () => {
    const outcome = retrieve({
      ...empty,
      ...heard('Unity'),
      memories: [memoryOf('   ', 'preference', 5)],
    });

    expect(outcome.items).toStrictEqual([]);
  });

  it('handles a relationship with no history', () => {
    const outcome = retrieve({
      ...empty,
      ...heard('How are we doing?'),
      relationship: relationshipOf({ stage: 'new', sharedUnderstanding: 0 }),
    });

    expect(() => outcome.items).not.toThrow();
  });

  it('reports a truncated candidate set as a degradation', () => {
    const outcome = retrieve({ ...world(), candidatesTruncated: true });

    expect(outcome.degraded.some((entry) => entry.reason === 'candidates_truncated')).toBe(
      true,
    );
  });
});

describe('the bridge to Core', () => {
  it('projects to exactly the memories, in rank order', () => {
    const outcome = retrieve(world());
    const projected = toRetrievedMemories(outcome);

    expect(projected.map((entry) => entry.memory.id)).toStrictEqual(
      outcome.items
        .filter((item) => item.source === 'memory')
        .map((item) => (item.source === 'memory' ? item.memory.id : '')),
    );
  });

  it('never renders an insight as a memory', () => {
    // The one confusion this whole subsystem exists to prevent: a conclusion the
    // companion drew, arriving in context as though the user had said it.
    const outcome = retrieve(world());
    const projected = toRetrievedMemories(outcome);
    const statements = outcome.items
      .filter((item) => item.source === 'insight')
      .map((item) => item.text);

    expect(statements.length).toBeGreaterThan(0);
    for (const statement of statements) {
      expect(projected.some((entry) => entry.memory.content === statement)).toBe(false);
    }
  });

  it('fills Core’s five signals from the twelve', () => {
    const projected = toRetrievedMemories(retrieve(world()));
    const first = projected[0];

    expect(first).toBeDefined();
    expect(Object.keys(first?.signals ?? {}).sort()).toStrictEqual([
      'emotionalSalience',
      'goalRelevance',
      'importance',
      'recency',
      'semantic',
    ]);
  });

  it('falls back to lexical for `semantic` when nothing was embedded', () => {
    // Reporting zero would tell a reader the memory was semantically unrelated,
    // when in fact nothing was measured.
    const projected = toRetrievedMemories(retrieve(world()));

    expect(projected.every((entry) => entry.signals.semantic >= 0)).toBe(true);
    expect(projected.some((entry) => entry.signals.semantic > 0)).toBe(true);
  });

  it('produces scores Core can treat as confidences', () => {
    for (const entry of toRetrievedMemories(retrieve(world()))) {
      expect(entry.score).toBeGreaterThanOrEqual(0);
      expect(entry.score).toBeLessThanOrEqual(1);
    }
  });
});
