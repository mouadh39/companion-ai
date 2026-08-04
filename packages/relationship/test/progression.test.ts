import { describe, expect, it } from 'vitest';
import { timestamp } from '@nexa/models';
import { advance, replay, stageFor } from '@nexa/relationship';
import { dayOffset, relationshipAt, signalAt, spread } from './fixtures.js';

/**
 * The central claim: relationships never change dramatically because of a
 * single conversation, and progression requires sustained interaction rather
 * than isolated events.
 *
 * Every test here attacks that claim from the direction most likely to break
 * it — a burst of enthusiasm, a perfect first exchange, an unbounded signal.
 */

describe('a single conversation cannot move the relationship', () => {
  it('leaves the stage unchanged after one interaction', () => {
    const { relationship, stageChange } = advance(
      relationshipAt(),
      signalAt(1, { intent: 'emotional_support', exchangeTurns: 20 }),
    );

    expect(stageChange).toBeNull();
    expect(relationship.type).toBe('new');
  });

  it('caps every dimension at the per-interaction ceiling', () => {
    const before = relationshipAt();
    // The most trust-building signal available, at maximum depth.
    const { relationship } = advance(
      before,
      signalAt(1, {
        intent: 'emotional_support',
        exchangeTurns: 100,
        acknowledgedUncertainty: true,
      }),
    );

    for (const axis of ['trust', 'familiarity', 'warmth', 'reliance'] as const) {
      const moved = Math.abs(
        relationship.dimensions[axis] - before.dimensions[axis],
      );
      expect(moved).toBeLessThanOrEqual(0.02 + 1e-9);
    }
  });

  it('cannot be rushed by volume alone', () => {
    // 300 interactions — more than `trusted` requires — all in one day.
    const burst = replay(relationshipAt(), spread(300, 1));

    expect(stageFor(burst, timestamp(dayOffset(1)))).toBe('new');
  });

  it('cannot be reached by elapsed time alone', () => {
    // A year of silence after a single meeting.
    const stale = relationshipAt({ interactionCount: 1 });

    expect(stageFor(stale, timestamp(dayOffset(365)))).toBe('new');
  });

  it('advances only when volume, time and dimensions all hold', () => {
    const history = replay(relationshipAt(), spread(40, 30, { intent: 'planning' }));
    const at = timestamp(dayOffset(30));

    expect(history.interactionCount).toBe(40);
    expect(stageFor(history, at)).toBe('familiar');
  });
});

describe('progression through the ladder', () => {
  it('reaches acquainted only after both the count and the days', () => {
    const at5 = timestamp(dayOffset(1));
    const tooFast = replay(relationshipAt(), spread(6, 1));
    expect(stageFor(tooFast, at5)).toBe('new');

    const paced = replay(relationshipAt(), spread(6, 3));
    expect(stageFor(paced, timestamp(dayOffset(3)))).toBe('acquainted');
  });

  it('takes months of sustained contact to reach close', () => {
    const history = replay(
      relationshipAt(),
      spread(100, 70, { intent: 'emotional_support', exchangeTurns: 8 }),
    );

    expect(stageFor(history, timestamp(dayOffset(70)))).toBe('close');
  });

  it('reports an advance as a stage change', () => {
    // Four interactions is one short of the five `acquainted` requires.
    const nearly = replay(relationshipAt(), spread(4, 3));
    expect(nearly.type).toBe('new');

    const { stageChange } = advance(nearly, signalAt(3.5));

    expect(stageChange).toStrictEqual({
      from: 'new',
      to: 'acquainted',
      direction: 'advanced',
    });
  });

  it('never skips the intermediate stages when replayed in order', () => {
    let current = relationshipAt();
    const seen: string[] = [current.type];

    for (const signal of spread(120, 90, { intent: 'planning', exchangeTurns: 8 })) {
      const update = advance(current, signal);
      current = update.relationship;
      if (update.stageChange !== null) seen.push(update.stageChange.to);
    }

    // Monotonic and contiguous — no jump from `new` straight to `familiar`.
    expect(seen).toStrictEqual(['new', 'acquainted', 'familiar', 'close']);
  });
});

describe('lapsing and regression', () => {
  it('pauses progression while contact has lapsed', () => {
    const established = replay(relationshipAt(), spread(40, 30));

    const active = stageFor(established, timestamp(dayOffset(30)));
    const lapsed = stageFor(established, timestamp(dayOffset(200)));

    expect(active).toBe('familiar');
    expect(lapsed).not.toBe('familiar');
  });

  it('fades familiarity over a long absence, but only familiarity', () => {
    const established = replay(relationshipAt(), spread(60, 40, { intent: 'planning' }));
    const { relationship } = advance(established, signalAt(400));

    expect(relationship.dimensions.familiarity).toBeLessThan(
      established.dimensions.familiarity,
    );
    // Trust and warmth are earned. Silence does not revoke them.
    expect(relationship.dimensions.trust).toBeGreaterThanOrEqual(
      established.dimensions.trust,
    );
  });

  it('never lets familiarity fall to zero — a returning user is not a stranger', () => {
    const established = replay(relationshipAt(), spread(40, 30));
    const { relationship } = advance(established, signalAt(10_000));

    expect(relationship.dimensions.familiarity).toBeGreaterThanOrEqual(0.1);
  });

  it('reports a regression as a stage change rather than suppressing it', () => {
    const established = replay(relationshipAt(), spread(40, 30));
    expect(established.type).toBe('familiar');

    // Returning after a very long absence, having decayed below threshold.
    const { stageChange } = advance(established, signalAt(3_000));

    expect(stageChange?.direction).toBe('regressed');
  });

  it('does not let the pre-existing gap erode the interaction that ends it', () => {
    // Decay is applied before the signal, so returning after a long silence
    // must leave familiarity higher than it would have been on arrival.
    const established = replay(relationshipAt(), spread(40, 30));
    const returning = advance(established, signalAt(200)).relationship;
    const stillAway = advance(established, signalAt(201)).relationship;

    expect(returning.dimensions.familiarity).toBeGreaterThan(
      stillAway.dimensions.familiarity,
    );
  });
});
