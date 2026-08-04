import { describe, expect, it } from 'vitest';
import type { RetrievalBudget } from '@nexa/models';
import { DEFAULT_CONFIG, defaultBudget, estimateTokens, retrieve } from '@nexa/retrieval';
import type { RetrievalRequest } from '@nexa/retrieval';
import { at, idsOf, memoryOf, heard } from './fixtures.js';

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

/**
 * Equally relevant projects that are genuinely different remarks.
 *
 * The subject word has to vary. An earlier version of this fixture numbered them
 * — "Unity module 1", "Unity module 2" — and the numbers are stripped as
 * single-character tokens, so all twelve had identical term sets and the
 * deduplicator collapsed them into one. That was the engine working; the fixture
 * was the thing that was wrong.
 */
const SUBJECTS = [
  'shader', 'physics', 'audio', 'input', 'netcode', 'lighting',
  'animation', 'terrain', 'particle', 'navmesh', 'texture', 'camera',
  'collision', 'material', 'scene', 'prefab', 'canvas', 'timeline',
  'addressable', 'profiler', 'gizmo', 'raycast', 'skybox', 'mesh',
  'rigidbody', 'joint', 'sprite', 'tilemap', 'cinemachine', 'burst',
] as const;

const manyProjects = (count = 12) =>
  Array.from({ length: count }, (_, index) =>
    memoryOf(`The Unity ${SUBJECTS[index % SUBJECTS.length] ?? index} module.`, 'project', index),
  );

const budgetOf = (overrides: Partial<RetrievalBudget> = {}): RetrievalBudget => ({
  ...defaultBudget(),
  ...overrides,
});

describe('the item budget', () => {
  it('never returns more than it was allowed', () => {
    const outcome = ask({
      ...heard('Unity module'),
      memories: manyProjects(),
      budget: budgetOf({ maxItems: 3, maxPerClass: {} }),
    });

    expect(outcome.items).toHaveLength(3);
    expect(outcome.spend.items).toBe(3);
  });

  it('records that the ceiling bound the result', () => {
    const outcome = ask({
      ...heard('Unity module'),
      memories: manyProjects(),
      budget: budgetOf({ maxItems: 3, maxPerClass: {} }),
    });

    expect(outcome.degraded.some((entry) => entry.reason === 'budget_items')).toBe(true);
  });

  it('keeps the best ones', () => {
    const outcome = ask({
      ...heard('Unity module'),
      memories: manyProjects(),
      budget: budgetOf({ maxItems: 3, maxPerClass: {} }),
    });

    // Every one is equally on topic, so recency decides — the ordering is not
    // arbitrary even when the relevance is a tie.
    expect(outcome.items[0]?.score).toBeGreaterThanOrEqual(outcome.items[2]?.score ?? 1);
  });

  it('reports everything that lost, not just the first loser', () => {
    const outcome = ask({
      ...heard('Unity module'),
      memories: manyProjects(),
      budget: budgetOf({ maxItems: 3, maxPerClass: {} }),
    });

    const onBudget = outcome.excluded.filter((entry) => entry.reason === 'budget_items');
    expect(onBudget.length).toBeGreaterThan(1);
  });
});

describe('the token budget', () => {
  it('stays inside the ceiling', () => {
    const outcome = ask({
      ...heard('Unity module'),
      memories: manyProjects(),
      budget: budgetOf({ maxItems: 50, maxTokens: 40, maxPerClass: {} }),
    });

    expect(outcome.spend.tokens).toBeLessThanOrEqual(40);
    expect(outcome.degraded.some((entry) => entry.reason === 'budget_tokens')).toBe(true);
  });

  it('keeps filling with something smaller rather than stopping at the first misfit', () => {
    // Stopping at the first over-budget item leaves budget unspent for no reason
    // beyond the convenience of the loop.
    const outcome = ask({
      ...heard('shader'),
      memories: [
        memoryOf(`The shader work ${'x'.repeat(400)}`, 'project', 1),
        memoryOf('The shader is fine.', 'project', 2),
      ],
      budget: budgetOf({ maxItems: 10, maxTokens: 30, maxPerClass: {} }),
    });

    expect(idsOf(outcome)).toContain('mem-the-shader-is-fine-');
  });

  it('uses the caller’s estimator when one is supplied', () => {
    const outcome = ask({
      ...heard('Unity module'),
      memories: manyProjects(3),
      budget: budgetOf({ maxItems: 10, maxTokens: 10, maxPerClass: {} }),
      config: { ...DEFAULT_CONFIG, estimate: () => 1 },
    });

    expect(outcome.spend.tokens).toBe(3);
  });
});

describe('the per-class budget', () => {
  it('stops one class from taking every slot', () => {
    const outcome = ask({
      ...heard('Unity module'),
      memories: manyProjects(),
      budget: budgetOf({ maxItems: 10, maxPerClass: { project: 2 } }),
    });

    expect(outcome.spend.perClass.project).toBe(2);
    expect(outcome.excluded.some((entry) => entry.reason === 'class_cap')).toBe(true);
  });

  it('leaves room for other classes when one floods the ranking', () => {
    const outcome = ask({
      ...heard('Unity module'),
      memories: [
        ...manyProjects(),
        memoryOf('I prefer the Unity module layout.', 'preference', 5),
      ],
      budget: budgetOf({ maxItems: 4, maxPerClass: { project: 2 } }),
    });

    const classes = outcome.items.map((item) => item.retrievalClass);
    expect(classes.filter((name) => name === 'project')).toHaveLength(2);
    expect(classes).toContain('preference');
  });
});

describe('reserved slots', () => {
  it('holds room for a class that would otherwise be crowded out', () => {
    const outcome = ask({
      ...heard('Unity module'),
      memories: [
        ...manyProjects(),
        memoryOf('I like tidy Unity module conventions.', 'preference', 200),
      ],
      budget: budgetOf({ maxItems: 3, maxPerClass: {}, reserved: { preference: 1 } }),
    });

    expect(outcome.items.map((item) => item.retrievalClass)).toContain('preference');
  });

  it('does not let a reservation smuggle in something irrelevant', () => {
    // Reservations bound competition; they never relax the relevance floor.
    const outcome = ask({
      ...heard('Unity module'),
      memories: [...manyProjects(), memoryOf('I like pizza with extra cheese.', 'preference', 5)],
      budget: budgetOf({ maxItems: 5, maxPerClass: {}, reserved: { preference: 2 } }),
    });

    expect(idsOf(outcome)).not.toContain('mem-i-like-pizza-with-extra-cheese-');
  });

  it('fills reservations in a fixed class order', () => {
    const memories = [
      memoryOf('I like tidy Unity module conventions.', 'preference', 5),
      memoryOf('My Unity module rewrite.', 'project', 5),
    ];
    const budget = budgetOf({
      maxItems: 1,
      maxPerClass: {},
      reserved: { project: 1, preference: 1 },
    });

    // `preference` precedes `project` in the declared class order, so it wins
    // the single slot regardless of how the literal was written.
    expect(ask({ ...heard('Unity module'), memories, budget }).items[0]
      ?.retrievalClass).toBe('preference');
  });
});

describe('graceful degradation', () => {
  it('returns fewer items rather than overflowing', () => {
    const outcome = ask({
      ...heard('Unity module'),
      memories: manyProjects(30),
      budget: budgetOf({ maxItems: 5, maxTokens: 60, maxPerClass: {} }),
    });

    expect(outcome.items.length).toBeLessThanOrEqual(5);
    expect(outcome.spend.tokens).toBeLessThanOrEqual(60);
  });

  it('caps the explanation list but never the count', () => {
    const outcome = ask({
      ...heard('Unity module'),
      memories: manyProjects(80),
      budget: budgetOf({ maxItems: 2, maxPerClass: {} }),
      config: { ...DEFAULT_CONFIG, maxExplanations: 5 },
    });

    expect(outcome.excluded).toHaveLength(5);
    expect(outcome.excludedCount).toBeGreaterThan(5);
  });

  it('shrinks the item budget for a companion asked to be brief', () => {
    const minimal = ask({
      ...heard('Unity module'),
      memories: manyProjects(),
      budget: budgetOf({ maxItems: 10, maxPerClass: {} }),
      expression: { detail: 'minimal' } as never,
    });
    const thorough = ask({
      ...heard('Unity module'),
      memories: manyProjects(),
      budget: budgetOf({ maxItems: 10, maxPerClass: {} }),
      expression: { detail: 'thorough' } as never,
    });

    expect(minimal.items.length).toBeLessThan(thorough.items.length);
  });

  it('never lets brevity become amnesia', () => {
    const outcome = ask({
      ...heard('Unity module'),
      memories: manyProjects(),
      budget: budgetOf({ maxItems: 1, maxPerClass: {} }),
      expression: { detail: 'minimal' } as never,
    });

    expect(outcome.items).toHaveLength(1);
  });

  it('never lets expression raise a ceiling the caller set', () => {
    const outcome = ask({
      ...heard('Unity module'),
      memories: manyProjects(),
      budget: budgetOf({ maxItems: 2, maxPerClass: {} }),
      expression: { detail: 'thorough' } as never,
    });

    expect(outcome.items).toHaveLength(2);
  });
});

describe('the default token estimate', () => {
  it('is four characters to a token, and monotonic', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('abcde')).toBe(2);
    expect(estimateTokens('a'.repeat(400))).toBeGreaterThan(estimateTokens('a'.repeat(4)));
  });
});
