import { describe, expect, it } from 'vitest';
import type { RelevanceSignals } from '@nexa/models';
import { ANCHOR_SIGNALS, RETRIEVAL_CLASSES, SIGNAL_NAMES } from '@nexa/models';
import {
  CLASS_POLICIES,
  DEFAULT_CONFIG,
  MAX_SINGLE_WEIGHT,
  MIN_MEASURED_SIGNALS,
  NO_SIGNALS,
  anchorOf,
  byRank,
  cosine,
  decay,
  policyFor,
  retrieve,
  scoreOf,
  similarityOf,
} from '@nexa/retrieval';
import type { Ranked, RetrievalRequest } from '@nexa/retrieval';
import { at, idsOf, insightOf, memoryOf, heard } from './fixtures.js';

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

describe('the weight table is coherent', () => {
  it('sums to one for every class, so scores are comparable between them', () => {
    for (const name of RETRIEVAL_CLASSES) {
      const total = Object.values(policyFor(name).weights).reduce(
        (sum, weight) => sum + weight,
        0,
      );
      expect(total, `weights for '${name}'`).toBeCloseTo(1, 6);
    }
  });

  it('lets no single dimension be more than a quarter of the answer', () => {
    // The mechanical form of "do not rely on a single score". Without this a
    // future tuning session quietly turns the engine into cosine similarity with
    // eleven decorative signals.
    for (const name of RETRIEVAL_CLASSES) {
      for (const [signal, weight] of Object.entries(policyFor(name).weights)) {
        expect(weight, `${name}.${signal}`).toBeLessThanOrEqual(MAX_SINGLE_WEIGHT);
      }
    }
  });

  it('gives every class at least one anchoring dimension to be found by', () => {
    for (const name of RETRIEVAL_CLASSES) {
      const anchored = ANCHOR_SIGNALS.filter(
        (signal) => (policyFor(name).weights[signal] ?? 0) > 0,
      );
      expect(anchored.length, `'${name}' has no anchor weight`).toBeGreaterThan(0);
    }
  });

  it('names only real signals', () => {
    const known = new Set<string>(SIGNAL_NAMES);
    for (const name of RETRIEVAL_CLASSES) {
      for (const signal of Object.keys(policyFor(name).weights)) {
        expect(known.has(signal), `unknown signal '${signal}' in '${name}'`).toBe(true);
      }
    }
  });

  it('decays temporary classes far faster than durable ones', () => {
    expect(policyFor('recent_event').halfLifeDays).toBeLessThan(
      policyFor('identity').halfLifeDays / 100,
    );
    expect(policyFor('temporary').durability).toBe('temporary');
    expect(policyFor('identity').durability).toBe('durable');
  });
});

describe('the anchor is the strongest anchoring signal, and only that', () => {
  const signalsWith = (overrides: Partial<RelevanceSignals>): RelevanceSignals => ({
    ...NO_SIGNALS,
    ...overrides,
  });

  it('picks the highest', () => {
    expect(anchorOf(signalsWith({ lexical: 0.4, entity: 0.9 })).name).toBe('entity');
  });

  it('never picks a qualifier, however high it is', () => {
    const anchor = anchorOf(signalsWith({ lexical: 0.1, importance: 1, recency: 1 }));

    expect(anchor.name).toBe('lexical');
    expect(anchor.strength).toBe(0.1);
  });

  it('breaks ties in declared order, so it cannot depend on iteration', () => {
    expect(anchorOf(signalsWith({ semantic: 0.5, lexical: 0.5 })).name).toBe('semantic');
  });
});

describe('scoring is normalised by what could be measured', () => {
  it('does not penalise a memory for having no embedding yet', () => {
    // Over a store mid-way through a re-embed, scoring an absent dimension as
    // zero silently reorders everything.
    const policy = policyFor('preference');
    const signals = { ...NO_SIGNALS, lexical: 0.8, recency: 0.8, importance: 0.8, confidence: 0.8 };

    const withoutSemantic = scoreOf(
      { signals, measured: ['lexical', 'recency', 'importance', 'confidence'], semanticMiss: 'not_embedded' },
      policy,
    );
    const withSemanticEqual = scoreOf(
      {
        signals: { ...signals, semantic: 0.8 },
        measured: ['semantic', 'lexical', 'recency', 'importance', 'confidence'],
        semanticMiss: null,
      },
      policy,
    );

    expect(withoutSemantic).toBeCloseTo(withSemanticEqual, 2);
  });

  it('discounts a score resting on very few dimensions', () => {
    const policy = policyFor('preference');
    const thin = scoreOf(
      { signals: { ...NO_SIGNALS, lexical: 1 }, measured: ['lexical'], semanticMiss: null },
      policy,
    );

    expect(thin).toBeLessThan(1 / MIN_MEASURED_SIGNALS + 0.3);
  });

  it('returns zero when nothing this class weighs could be measured', () => {
    expect(
      scoreOf({ signals: NO_SIGNALS, measured: ['stability'], semanticMiss: null }, policyFor('identity')),
    ).toBe(0);
  });
});

describe('ordering is total and deterministic', () => {
  const entry = (id: string, score: number, anchorStrength: number, day: number): Ranked =>
    ({
      candidate: { id, at: at(-day) },
      signals: NO_SIGNALS,
      measured: [],
      anchor: 'lexical',
      anchorStrength,
      admitted: true,
      score,
      reasons: [],
    }) as unknown as Ranked;

  it('ranks by score first', () => {
    expect([entry('a', 0.2, 1, 0), entry('b', 0.8, 0, 0)].sort(byRank).map((e) => e.candidate.id))
      .toStrictEqual(['b', 'a']);
  });

  it('falls to anchor strength, then recency, then id', () => {
    const tied = [
      entry('z', 0.5, 0.5, 5),
      entry('a', 0.5, 0.5, 5),
      entry('m', 0.5, 0.5, 1),
      entry('q', 0.5, 0.9, 9),
    ];

    expect(tied.sort(byRank).map((e) => e.candidate.id)).toStrictEqual(['q', 'm', 'a', 'z']);
  });

  it('leaves nothing to the caller’s array order', () => {
    const memories = [
      memoryOf('Unity shaders are fiddly.', 'project', 5),
      memoryOf('Unity builds are slow.', 'project', 5),
      memoryOf('Unity input handling is odd.', 'project', 5),
    ];
    const forwards = ask({ ...heard('Unity'), memories });
    const backwards = ask({ ...heard('Unity'), memories: [...memories].reverse() });

    expect(idsOf(backwards)).toStrictEqual(idsOf(forwards));
  });

  it('numbers the ranks from one, in order', () => {
    const outcome = ask({
      ...heard('Unity'),
      memories: [
        memoryOf('Unity shaders are fiddly.', 'project', 5),
        memoryOf('Unity builds are slow.', 'project', 5),
      ],
    });

    expect(outcome.items.map((item) => item.rank)).toStrictEqual([1, 2]);
  });
});

describe('recency', () => {
  it('halves at the class half-life and keeps halving', () => {
    expect(decay(at(-7), at(0), 7)).toBeCloseTo(0.5, 3);
    expect(decay(at(-14), at(0), 7)).toBeCloseTo(0.25, 3);
    expect(decay(at(0), at(0), 7)).toBe(1);
  });

  it('never reaches zero, so nothing old becomes unreachable', () => {
    // A linear ramp to zero would make a ten-year-old milestone impossible to
    // surface even when the user asked about it directly.
    expect(decay(at(-3_650), at(0), 1_825)).toBeGreaterThan(0);
  });

  it('is total over a malformed instant', () => {
    expect(decay('not-a-date' as never, at(0), 7)).toBe(0);
    expect(decay(at(0), at(0), 0)).toBe(0);
  });

  it('measures a memory from its last reinforcement, not its creation', () => {
    const outcome = ask({
      ...heard('parcel'),
      memories: [
        memoryOf('The parcel is late.', 'temporary', 30, {
          lastReinforcedAt: at(-1),
          id: 'refreshed' as never,
        }),
        memoryOf('The parcel is late.', 'temporary', 30, { id: 'neglected' as never }),
      ],
    });

    const refreshed = outcome.items.find((item) => item.source === 'memory' && item.memory.id === 'refreshed');
    expect(refreshed?.signals.recency).toBeGreaterThan(0.4);
  });
});

describe('semantic similarity', () => {
  it('is one for identical vectors and zero for orthogonal ones', () => {
    expect(cosine([1, 0, 0], [1, 0, 0])).toBe(1);
    expect(cosine([1, 0, 0], [0, 1, 0])).toBe(0);
  });

  it('clamps opposition to zero rather than rescaling it to the middle', () => {
    // Mapping [-1,1] onto [0,1] would give an opposed candidate 0.5 — higher
    // than most genuinely unrelated material, for a signal whose job is to admit.
    expect(cosine([1, 0], [-1, 0])).toBe(0);
  });

  it('is total over mismatched or empty vectors', () => {
    expect(cosine([], [])).toBe(0);
    expect(cosine([1, 2], [1])).toBe(0);
    expect(cosine([0, 0], [1, 1])).toBe(0);
  });

  it('refuses to compare vectors from different models', () => {
    // Cosine across models returns an ordinary number that means nothing. The
    // arithmetic succeeds and the retrieval silently degrades, which is worse
    // than an error.
    const score = similarityOf(
      { model: 'voyage-3', dimensions: 2, query: [1, 0], vectors: new Map([['v1', [1, 0]]]) },
      { vectorId: 'v1', model: 'other-model', dimensions: 2, embeddedAt: at(-1) },
    );

    expect(score.similarity).toBe(0);
    expect(score.miss).toBe('incomparable');
  });

  it('reports a mid-migration store as degraded rather than ranking it quietly', () => {
    const outcome = ask({
      ...heard('Unity'),
      memories: [
        memoryOf('Unity is good.', 'preference', 1, {
          embedding: { vectorId: 'v1', model: 'old-model', dimensions: 2, embeddedAt: at(-1) },
        }),
      ],
      semantic: { model: 'voyage-3', dimensions: 2, query: [1, 0], vectors: new Map() },
    });

    expect(outcome.degraded.some((entry) => entry.reason === 'embeddings_incomparable')).toBe(true);
  });
});

describe('an insight is ranked on what an insight has', () => {
  it('weighs confidence and stability more than any other class does', () => {
    const weights = policyFor('reflection').weights;
    expect((weights.confidence ?? 0) + (weights.stability ?? 0)).toBeGreaterThan(0.35);
  });

  it('ranks a shaky conclusion below a settled one on the same topic', () => {
    const outcome = ask({
      ...heard('Do I work late?'),
      insights: [
        insightOf('The user works late.', 'habit', 5, {
          id: 'settled' as never,
          confidence: 0.75 as never,
          stability: 0.9,
        }),
        insightOf('The user works late often.', 'habit', 5, {
          id: 'shaky' as never,
          confidence: 0.35 as never,
          stability: 0.1,
        }),
      ],
    });

    expect(idsOf(outcome)[0]).toBe('settled');
  });
});

describe('every item can explain itself', () => {
  it('says what admitted it and what it scored across', () => {
    const outcome = ask({
      ...heard('Unity'),
      memories: [memoryOf('Unity is my engine of choice.', 'preference', 5)],
    });

    const item = outcome.items[0];
    expect(item?.reasons.some((reason) => reason.code === 'anchored_lexically')).toBe(true);
    expect(item?.reasons.find((reason) => reason.code === 'scored')?.detail).toContain(
      'dimensions',
    );
  });

  it('carries all twelve signals, measured or not', () => {
    const outcome = ask({
      ...heard('Unity'),
      memories: [memoryOf('Unity is my engine of choice.', 'preference', 5)],
    });

    expect(Object.keys(outcome.items[0]?.signals ?? {}).sort()).toStrictEqual(
      [...SIGNAL_NAMES].sort(),
    );
  });

  it('tells a caller how much of the picture the ranking had', () => {
    const outcome = ask({
      ...heard('Unity'),
      memories: [memoryOf('Unity is my engine of choice.', 'preference', 5)],
    });

    expect(outcome.degraded.map((entry) => entry.reason)).toContain('semantic_unavailable');
    expect(DEFAULT_CONFIG.classes).toBe(CLASS_POLICIES);
  });
});
