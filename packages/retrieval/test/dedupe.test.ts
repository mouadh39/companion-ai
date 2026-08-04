import { describe, expect, it } from 'vitest';
import { overlap, retrieve } from '@nexa/retrieval';
import type { RetrievalRequest } from '@nexa/retrieval';
import type { InsightEvidence } from '@nexa/models';
import { at, excludedFor, idsOf, insightOf, memoryOf, heard } from './fixtures.js';

const ask = (overrides: Partial<RetrievalRequest> = {}) =>
  retrieve({
    at: at(0),
    ...heard(''),
    conversation: [],
    memories: [],
    insights: [],
    goals: [],
    relationship: null,
    ...overrides,
  });

const evidenceFor = (memoryId: string): InsightEvidence => ({
  memoryId: memoryId as InsightEvidence['memoryId'],
  at: at(-5),
  source: 'user_stated',
  polarity: 'affirms',
  weight: 0.85,
});

describe('the same object twice', () => {
  it('counts a memory supplied twice only once', () => {
    // A caller that unions two candidate queries hands over duplicates. Missed,
    // every per-class count is silently wrong.
    const memory = memoryOf('Unity shaders are fiddly.', 'project', 5);
    const outcome = ask({ ...heard('Unity shaders'), memories: [memory, memory] });

    expect(outcome.items).toHaveLength(1);
    expect(outcome.spend.perClass.project).toBe(1);
  });

  it('reports the copy rather than dropping it silently', () => {
    const memory = memoryOf('Unity shaders are fiddly.', 'project', 5);
    const outcome = ask({ ...heard('Unity shaders'), memories: [memory, memory] });

    expect(outcome.excluded.some((entry) => entry.reason === 'duplicate')).toBe(true);
    expect(outcome.excludedCount).toBeGreaterThan(0);
  });
});

describe('two things saying one thing', () => {
  it('collapses a paraphrase that memory formation did not catch', () => {
    const outcome = ask({
      ...heard('Unity shaders'),
      memories: [
        memoryOf('Unity shaders are fiddly.', 'project', 5),
        memoryOf('Shaders in Unity are fiddly.', 'project', 6),
      ],
    });

    expect(outcome.items).toHaveLength(1);
  });

  it('keeps the higher-ranked of the pair, not the earlier one', () => {
    // The dedupe runs after ranking for exactly this reason: "first" has to mean
    // "best", not "whichever the caller happened to list first".
    const outcome = ask({
      ...heard('Unity shaders'),
      memories: [
        memoryOf('Unity shaders are fiddly.', 'project', 400, { id: 'stale' as never }),
        memoryOf('Shaders in Unity are fiddly.', 'project', 1, { id: 'fresh' as never }),
      ],
    });

    expect(idsOf(outcome)).toStrictEqual(['fresh']);
    expect(excludedFor(outcome, 'stale')?.reason).toBe('duplicate');
  });

  it('leaves genuinely different remarks alone', () => {
    const outcome = ask({
      ...heard('Unity'),
      memories: [
        memoryOf('The Unity shader module.', 'project', 5),
        memoryOf('The Unity physics module.', 'project', 6),
      ],
    });

    expect(outcome.items).toHaveLength(2);
  });

  it('measures sameness symmetrically', () => {
    // Coverage is directional and would make dedupe depend on which of a pair
    // was seen first; overlap is not.
    const a = 'Unity shaders are fiddly to debug on Android.';
    const b = 'Shaders in Unity are fiddly.';

    expect(overlap(a, b)).toBe(overlap(b, a));
  });
});

describe('an insight speaks for its own evidence', () => {
  const memories = [
    memoryOf('Please keep answers short.', 'preference', 30),
    memoryOf('That reply was too long for me.', 'preference', 20),
    memoryOf('Shorter is better, generally.', 'preference', 10),
  ];

  const conclusion = insightOf(
    'The user consistently prefers short, direct answers.',
    'communication',
    5,
    {
      confidence: 0.75 as never,
      stability: 0.8,
      supporting: memories.map((memory) => evidenceFor(memory.id)),
    },
  );

  it('drops the memories an admitted insight was drawn from', () => {
    const outcome = ask({
      ...heard('Do I prefer short answers?'),
      memories,
      insights: [conclusion],
    });

    const retrieved = idsOf(outcome);
    expect(retrieved).toContain(conclusion.id);
    for (const memory of memories) expect(retrieved).not.toContain(memory.id);
  });

  it('says the insight is why', () => {
    const outcome = ask({
      ...heard('Do I prefer short answers?'),
      memories,
      insights: [conclusion],
    });

    const excluded = outcome.excluded.find((entry) => entry.reason === 'subsumed_by_insight');
    expect(excluded?.detail).toContain(conclusion.id);
  });

  it('keeps the evidence when the insight did not make the cut', () => {
    // An insight nobody is going to hear has not said anything, and demoting
    // its evidence on the strength of it would lose both.
    const outcome = ask({
      ...heard('Do I prefer short answers?'),
      memories,
      insights: [{ ...conclusion, status: 'retired' }],
    });

    expect(idsOf(outcome).length).toBeGreaterThan(0);
    expect(outcome.items.every((item) => item.source === 'memory')).toBe(true);
  });

  it('leaves memories the insight does not rest on alone', () => {
    const unrelated = memoryOf('I prefer short walks after lunch.', 'preference', 15);
    const outcome = ask({
      ...heard('short'),
      memories: [...memories, unrelated],
      insights: [conclusion],
    });

    expect(idsOf(outcome)).toContain(unrelated.id);
  });
});

describe('nothing is ever removed without a record', () => {
  it('accounts for every candidate as kept or excluded', () => {
    const memory = memoryOf('Unity shaders are fiddly.', 'project', 5);
    const outcome = ask({
      ...heard('Unity shaders'),
      memories: [memory, memory, memoryOf('I like pizza.', 'preference', 5)],
      insights: [insightOf('The user enjoys chess.', 'interest', 5, { status: 'retired' })],
    });

    expect(outcome.items.length + outcome.excludedCount).toBe(outcome.consideredCount);
  });
});
