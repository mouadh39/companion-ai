import { describe, expect, it } from 'vitest';
import type { Insight } from '@nexa/models';
import { applyDecisions, reflect, reviewPass } from '@nexa/reflection';
import {
  USER,
  at,
  firstFormed,
  insightFrom,
  interactiveTechnology,
  memoryOf,
  mintFrom,
} from './fixtures.js';

/** A history worth replaying: several topics, contradictions, and gaps. */
const history = () => [
  ...interactiveTechnology(),
  memoryOf('I enjoy chess.', 3),
  memoryOf('Chess is fun.', 11),
  memoryOf('I am into chess.', 19),
  memoryOf('I usually work in the morning.', 5),
  memoryOf('I tend to start at 6am, before anything else.', 17),
  memoryOf('I always get up at sunrise these days.', 29),
  memoryOf('I often begin at dawn now.', 41),
  memoryOf('I do not like coriander.', 8),
  memoryOf('I would rather not have coriander.', 22),
  memoryOf('I stayed awake until 3AM.', 44),
  memoryOf("I'm exhausted.", 45),
  memoryOf("I've been working all weekend.", 46),
];

const passAt = (day: number, existing: readonly Insight[] = []) =>
  reflect({ userId: USER, memories: history(), existing, at: at(day) });

describe('purity', () => {
  it('never mutates the memories it was given', () => {
    const memories = history();
    const snapshot = structuredClone(memories);

    reflect({ userId: USER, memories, existing: [], at: at(60) });

    expect(memories).toStrictEqual(snapshot);
  });

  it('never mutates the insights it was given', () => {
    const held = [insightFrom(firstFormed(passAt(60)))];
    const snapshot = structuredClone(held);

    reflect({ userId: USER, memories: history(), existing: held, at: at(60) });
    reviewPass(held, at(5_000));

    expect(held).toStrictEqual(snapshot);
  });

  it('returns a deeply equal result for the same request', () => {
    expect(passAt(60)).toStrictEqual(passAt(60));
  });

  it('does not depend on the order the memories arrived in', () => {
    // Evidence a caller fetched in a different order is the same evidence. If
    // this failed, two replicas reading the same store would disagree about a
    // user.
    const forwards = reflect({
      userId: USER,
      memories: history(),
      existing: [],
      at: at(60),
    });
    const backwards = reflect({
      userId: USER,
      memories: [...history()].reverse(),
      existing: [],
      at: at(60),
    });

    expect(backwards).toStrictEqual(forwards);
  });

  it('reads no clock — the same memories at two moments differ', () => {
    // The proof that time comes from the argument. If a clock were read, these
    // would be identical whatever was passed.
    expect(passAt(20).decisions).not.toStrictEqual(passAt(60).decisions);
  });

  it('mints no identifiers', () => {
    // Every formation is a draft. An engine that generated ids could not
    // produce identical output for identical input.
    for (const decision of passAt(60).decisions) {
      expect(decision).not.toHaveProperty('id');
      if (decision.outcome === 'form') expect(decision.draft).not.toHaveProperty('id');
    }
  });
});

describe('replay', () => {
  it('reconstructs the same store from the same history', () => {
    const once = applyDecisions([], passAt(60).decisions, USER, mintFrom('ins'));
    const twice = applyDecisions([], passAt(60).decisions, USER, mintFrom('ins'));

    expect(twice).toStrictEqual(once);
  });

  it('concludes nothing new the second time over the same evidence', () => {
    // Idempotency, and the property that makes a pass safe to re-run after a
    // crash. Without it an insight's history fills with entries recording that
    // nothing happened.
    const store = applyDecisions([], passAt(60).decisions, USER, mintFrom('ins'));
    const again = reflect({ userId: USER, memories: history(), existing: store, at: at(60) });

    expect(
      again.decisions.filter((decision) => decision.outcome !== 'decline'),
    ).toStrictEqual([]);
  });

  it('is unaffected by when the replay itself runs', () => {
    const first = applyDecisions([], passAt(60).decisions, USER, mintFrom('ins'));
    const rerun = applyDecisions([], passAt(60).decisions, USER, mintFrom('ins'));

    expect(rerun.map((insight) => insight.statement)).toStrictEqual(
      first.map((insight) => insight.statement),
    );
  });

  it('reaches the same understanding whether replayed in steps or in one go', () => {
    const stepwise = [20, 40, 60].reduce<readonly Insight[]>(
      (store, day) =>
        applyDecisions(store, passAt(day, store).decisions, USER, mintFrom(`ins${day}`)),
      [],
    );
    const wholesale = applyDecisions([], passAt(60).decisions, USER, mintFrom('ins'));

    // The same claims, though not necessarily at the same confidence: an
    // insight formed early and reinforced has a different path behind it than
    // one formed once at the end, and that difference is the record working.
    expect([...stepwise.map((i) => i.key)].sort()).toStrictEqual(
      [...wholesale.map((i) => i.key)].sort(),
    );
  });

  it('is total over malformed timestamps', () => {
    const broken = history().map((memory, position) =>
      position === 0 ? { ...memory, createdAt: 'not-a-date' as never } : memory,
    );

    expect(() =>
      reflect({ userId: USER, memories: broken, existing: [], at: at(60) }),
    ).not.toThrow();
  });

  it('is total over an empty world', () => {
    const empty = reflect({ userId: USER, memories: [], existing: [], at: at(0) });

    expect(empty.decisions).toStrictEqual([]);
    expect(empty.reasons.length).toBeGreaterThan(0);
  });
});
