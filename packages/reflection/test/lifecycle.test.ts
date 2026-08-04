import { describe, expect, it } from 'vitest';
import type { Insight, InsightDecision } from '@nexa/models';
import {
  applyDecisions,
  assertable,
  policyFor,
  rankAssertable,
  reflect,
  reviewInsight,
  reviewPass,
} from '@nexa/reflection';
import { USER, at, firstFormed, insightFrom, memoryOf, mintFrom, only } from './fixtures.js';

const chess = (count: number) =>
  [
    memoryOf('I enjoy chess.', 0),
    memoryOf('Chess is fun.', 8),
    memoryOf('I am into chess.', 16),
    memoryOf('Chess in the park is fun.', 25),
    memoryOf('I enjoy chess tournaments.', 32),
    memoryOf('I enjoy chess puzzles.', 50),
  ].slice(0, count);

const heldFrom = (count: number, day: number): Insight =>
  insightFrom(
    firstFormed(reflect({ userId: USER, memories: chess(count), existing: [], at: at(day) })),
    'ins-chess',
  );

const single = (decisions: readonly InsightDecision[]): InsightDecision => {
  const decision = decisions.find((entry) => entry.key === 'interest:literal:chess');
  if (decision === undefined) throw new Error('no decision for the chess insight');
  return decision;
};

describe('confidence grows with corroboration', () => {
  it('is surer after two more distinct memories', () => {
    const held = heldFrom(3, 20);
    const result = reflect({
      userId: USER,
      memories: chess(5),
      existing: [held],
      at: at(40),
    });

    const decision = single(result.decisions);
    expect(decision.outcome === 'revise' || decision.outcome === 'reinforce').toBe(true);
    if (decision.outcome !== 'revise' && decision.outcome !== 'reinforce') return;
    expect(decision.adjustment.confidence).toBeGreaterThan(held.confidence);
  });

  it('rewords itself when certainty crosses a band', () => {
    const held = heldFrom(3, 20);
    expect(held.statement).toBe('The user may enjoy chess.');

    const decision = single(
      reflect({ userId: USER, memories: chess(5), existing: [held], at: at(40) }).decisions,
    );

    expect(decision.outcome).toBe('revise');
    if (decision.outcome !== 'revise') return;
    expect(decision.adjustment.statement).not.toBe(held.statement);
    expect(decision.adjustment.revision).toBe(held.revision + 1);
  });

  it('reinforces without rewording when the band holds', () => {
    const held = heldFrom(5, 40);
    const decision = single(
      reflect({ userId: USER, memories: chess(6), existing: [held], at: at(60) }).decisions,
    );

    expect(decision.outcome).toBe('reinforce');
    if (decision.outcome !== 'reinforce') return;
    expect(decision.adjustment.statement).toBe(held.statement);
    expect(decision.adjustment.revision).toBe(held.revision);
  });

  it('pushes expiry out when it is supported again', () => {
    const held = heldFrom(5, 40);
    const decision = single(
      reflect({ userId: USER, memories: chess(6), existing: [held], at: at(60) }).decisions,
    );

    if (decision.outcome !== 'reinforce') throw new Error('expected a reinforcement');
    expect(Date.parse(decision.adjustment.expiresAt ?? '')).toBeGreaterThan(
      Date.parse(held.expiresAt ?? ''),
    );
  });

  it('never shortens a life by being supported', () => {
    // Setting expiry to `at + extension` outright would pull a long-lived
    // insight's expiry closer, so corroboration would cost it time.
    const held = { ...heldFrom(5, 40), expiresAt: at(5_000) };
    const decision = single(
      reflect({ userId: USER, memories: chess(6), existing: [held], at: at(60) }).decisions,
    );

    if (decision.outcome !== 'reinforce') throw new Error('expected a reinforcement');
    expect(decision.adjustment.expiresAt).toBe(held.expiresAt);
  });
});

describe('what time alone does', () => {
  const stale = (day: number): Insight => ({
    ...heldFrom(3, 20),
    lastSupportedAt: at(0),
    expiresAt: at(5_000),
    updatedAt: at(day),
  });

  it('leaves an insight alone inside its staleness window', () => {
    expect(reviewInsight(stale(100), at(100))).toBeNull();
  });

  it('weakens it once support has gone stale', () => {
    const decision = reviewInsight(stale(190), at(190));

    expect(decision?.outcome).toBe('weaken');
    if (decision?.outcome !== 'weaken') return;
    expect(decision.adjustment.confidence).toBeLessThan(stale(190).confidence);
    expect(decision.adjustment.change.kind).toBe('decayed');
  });

  it('leaves the evidence-derived confidence untouched while decaying', () => {
    // They answer different questions: one is what is believed now, the other
    // is what the evidence supports. Decaying both would compound.
    const insight = stale(190);
    const decision = reviewInsight(insight, at(190));

    if (decision?.outcome !== 'weaken') throw new Error('expected a weakening');
    expect(decision.adjustment.evidenceConfidence).toBe(insight.evidenceConfidence);
  });

  it('is idempotent — running it twice does not age anything twice', () => {
    const insight = stale(190);
    const first = reviewInsight(insight, at(190));
    if (first?.outcome !== 'weaken') throw new Error('expected a weakening');

    const applied = applyDecisions([insight], [first], USER, mintFrom('ins'))[0];
    expect(applied).toBeDefined();
    expect(reviewInsight(applied as Insight, at(190))).toBeNull();
  });

  it('retires it when decay takes it under the floor its kind requires', () => {
    const decision = reviewInsight(stale(240), at(240));

    expect(decision?.outcome).toBe('retire');
    if (decision?.outcome !== 'retire') return;
    expect(decision.reason).toBe('unsupported');
  });

  it('retires it on expiry before doing any arithmetic', () => {
    const expiring: Insight = { ...heldFrom(3, 20), expiresAt: at(50) };
    const decision = reviewInsight(expiring, at(60));

    expect(decision?.outcome).toBe('retire');
    if (decision?.outcome !== 'retire') return;
    expect(decision.reason).toBe('expired');
  });

  it('does not re-form a retired conclusion from the very evidence it let go', () => {
    // Otherwise expiry is a loop: retire for want of fresh support, re-form
    // from the same memories, retire again, forever.
    const expiring: Insight = { ...heldFrom(3, 20), expiresAt: at(50) };
    const retired = applyDecisions(
      [expiring],
      reviewPass([expiring], at(60)),
      USER,
      mintFrom('ins'),
    );

    const result = reflect({
      userId: USER,
      memories: chess(3),
      existing: retired,
      at: at(61),
    });

    expect(single(result.decisions).outcome).toBe('decline');
    if (single(result.decisions).outcome !== 'decline') return;
    expect(
      result.decisions.some(
        (decision) => decision.outcome === 'decline' && decision.reason === 'already_concluded',
      ),
    ).toBe(true);
  });

  it('re-forms it once genuinely new evidence appears', () => {
    const expiring: Insight = { ...heldFrom(3, 20), expiresAt: at(50) };
    const retired = applyDecisions(
      [expiring],
      reviewPass([expiring], at(60)),
      USER,
      mintFrom('ins'),
    );

    const result = reflect({
      userId: USER,
      memories: chess(6),
      existing: retired,
      at: at(61),
    });

    expect(single(result.decisions).outcome).toBe('form');
  });

  it('never revives what is already retired or superseded', () => {
    const held = heldFrom(3, 20);
    expect(reviewInsight({ ...held, status: 'retired' }, at(5_000))).toBeNull();
    expect(reviewInsight({ ...held, status: 'superseded' }, at(5_000))).toBeNull();
  });

  it('retires rather than deletes', () => {
    const expiring: Insight = { ...heldFrom(3, 20), expiresAt: at(50) };
    const decision = reviewInsight(expiring, at(60));
    if (decision === null) throw new Error('expected a retirement');

    const store = applyDecisions([expiring], [decision], USER, mintFrom('ins'));

    expect(store).toHaveLength(1);
    expect(store[0]?.status).toBe('retired');
    expect(store[0]?.statement).toBe(expiring.statement);
    expect(store[0]?.supporting).toHaveLength(3);
  });

  it('returns decisions in order, so a replayed pass matches', () => {
    const insights = [
      { ...heldFrom(3, 20), id: 'a' as Insight['id'], expiresAt: at(50) },
      { ...heldFrom(3, 20), id: 'b' as Insight['id'], expiresAt: at(5_000) },
      { ...heldFrom(3, 20), id: 'c' as Insight['id'], expiresAt: at(50) },
    ];

    const first = reviewPass(insights, at(60));
    expect(first).toStrictEqual(reviewPass(insights, at(60)));
    expect(
      first.map((decision) => (decision.outcome === 'retire' ? decision.targetId : null)),
    ).toStrictEqual(['a', 'c']);
  });
});

describe('deleting the evidence deletes the conclusion', () => {
  it('retires an insight whose evidence has been withdrawn below the minimum', () => {
    const held = heldFrom(3, 20);
    const result = reflect({
      userId: USER,
      memories: chess(3),
      existing: [held],
      withdrawn: [chess(3)[0]?.id ?? ('' as never)],
      at: at(30),
    });

    const retired = only(result, 'retire')[0];
    expect(retired).toBeDefined();
    if (retired?.outcome !== 'retire') return;
    expect(retired.reason).toBe('evidence_withdrawn');
  });

  it('weakens rather than retires when enough evidence survives', () => {
    const held = heldFrom(5, 40);
    const result = reflect({
      userId: USER,
      memories: chess(5),
      existing: [held],
      withdrawn: [chess(5)[4]?.id ?? ('' as never)],
      at: at(50),
    });

    const decision = single(result.decisions);
    expect(decision.outcome).toBe('weaken');
    if (decision.outcome !== 'weaken') return;
    expect(decision.adjustment.supporting).toHaveLength(4);
    expect(decision.adjustment.confidence).toBeLessThan(held.confidence);
  });

  it('does not cite a withdrawn memory anywhere in what it keeps', () => {
    const gone = chess(5)[4]?.id;
    const held = heldFrom(5, 40);
    const result = reflect({
      userId: USER,
      memories: chess(5),
      existing: [held],
      withdrawn: [gone ?? ('' as never)],
      at: at(50),
    });

    const store = applyDecisions([held], result.decisions, USER, mintFrom('ins'));
    for (const insight of store) {
      expect(insight.supporting.some((entry) => entry.memoryId === gone)).toBe(false);
      expect(insight.opposing.some((entry) => entry.memoryId === gone)).toBe(false);
    }
  });

  it('does not rebuild the same insight in the pass that retired it', () => {
    // More evidence about a topic does not make yesterday's conclusion, drawn
    // partly from deleted memories, legitimate again.
    const held = heldFrom(3, 20);
    const result = reflect({
      userId: USER,
      memories: chess(6),
      existing: [held],
      withdrawn: [chess(3)[0]?.id ?? ('' as never)],
      at: at(60),
    });

    const forKey = result.decisions.filter(
      (decision) => decision.key === 'interest:literal:chess',
    );
    expect(forKey).toHaveLength(1);
    expect(forKey[0]?.outcome).toBe('retire');
  });
});

describe('what a consumer is allowed to say', () => {
  it('keeps a suspicion it will not assert', () => {
    const held = heldFrom(3, 20);

    expect(held.confidence).toBeGreaterThan(policyFor('interest').confidenceFloor);
    expect(assertable(held)).toBe(false);
  });

  it('asserts one it has earned', () => {
    expect(assertable(heldFrom(5, 40))).toBe(true);
  });

  it('never asserts a contested insight, however sure it is', () => {
    const contested: Insight = { ...heldFrom(5, 40), status: 'contested' };
    expect(assertable(contested)).toBe(false);
  });

  it('ranks a steadily held claim above a repeatedly revised one', () => {
    const steady: Insight = { ...heldFrom(5, 40), id: 'steady' as Insight['id'] };
    const churned: Insight = {
      ...steady,
      id: 'churned' as Insight['id'],
      key: 'interest:literal:go' as Insight['key'],
      stability: steady.stability / 4,
    };

    expect(rankAssertable([churned, steady]).map((insight) => insight.id)).toStrictEqual([
      'steady',
      'churned',
    ]);
  });
});
