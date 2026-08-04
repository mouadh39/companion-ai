import { describe, expect, it } from 'vitest';
import { MAX_DIMENSION_DELTA_PER_INTERACTION, timestamp } from '@nexa/models';
import {
  advance,
  applyDeltas,
  averageGapDays,
  countersAfter,
  daysBetween,
  deltasFor,
  deriveProfile,
  replay,
} from '@nexa/relationship';
import { dayOffset, mixed, relationshipAt, signalAt, spread } from './fixtures.js';

const at = (days: number) => timestamp(dayOffset(days));

describe('purity', () => {
  it('never mutates the relationship it was given', () => {
    const before = relationshipAt();
    const snapshot = structuredClone(before);

    advance(before, signalAt(1, { intent: 'planning' }));
    deriveProfile(before, at(1));

    expect(before).toStrictEqual(snapshot);
  });

  it('never mutates the signal it was given', () => {
    const signal = signalAt(1, { intent: 'request' });
    const snapshot = structuredClone(signal);

    advance(relationshipAt(), signal);

    expect(signal).toStrictEqual(snapshot);
  });

  it('returns a deeply equal result for the same inputs', () => {
    const relationship = replay(relationshipAt(), spread(20, 15));
    const signal = signalAt(16, { intent: 'planning' });

    expect(advance(relationship, signal)).toStrictEqual(advance(relationship, signal));
    expect(deriveProfile(relationship, at(16))).toStrictEqual(
      deriveProfile(relationship, at(16)),
    );
  });

  it('reads no clock — the same record at two different `at` values differs', () => {
    // The proof that time comes from the argument. If a clock were read, these
    // would be identical whatever was passed.
    const relationship = replay(relationshipAt(), spread(20, 15));

    expect(deriveProfile(relationship, at(15)).cadence).not.toBe(
      deriveProfile(relationship, at(400)).cadence,
    );
  });
});

describe('replay', () => {
  it('reconstructs the same relationship from the same signals', () => {
    const signals = mixed(120, 90);

    expect(replay(relationshipAt(), signals)).toStrictEqual(
      replay(relationshipAt(), signals),
    );
  });

  it('is equivalent to applying the signals one at a time', () => {
    const signals = mixed(50, 40);

    let stepwise = relationshipAt();
    for (const signal of signals) stepwise = advance(stepwise, signal).relationship;

    expect(replay(relationshipAt(), signals)).toStrictEqual(stepwise);
  });

  it('depends on order, so a reordered history is a different relationship', () => {
    const signals = mixed(30, 25);
    const reversed = [...signals].reverse();

    // Not a defect — it is the point. A relationship is a path, not a bag of
    // events, and decay in particular depends on when the gaps fell.
    expect(replay(relationshipAt(), reversed)).not.toStrictEqual(
      replay(relationshipAt(), signals),
    );
  });

  it('is unaffected by when the replay itself runs', () => {
    // Every timestamp comes from the signals, so there is nothing for a
    // "current time" to influence. This is what makes a stored history
    // explainable years later.
    const signals = mixed(80, 60);
    const once = replay(relationshipAt(), signals);

    expect(deriveProfile(once, at(60))).toStrictEqual(deriveProfile(once, at(60)));
  });
});

describe('the rate cap holds for any input', () => {
  it('clamps a caller-supplied delta beyond the ceiling', () => {
    const start = relationshipAt().dimensions;
    const moved = applyDeltas(start, { trust: 10, familiarity: -10 });

    expect(moved.trust - start.trust).toBeCloseTo(MAX_DIMENSION_DELTA_PER_INTERACTION, 6);
    expect(start.familiarity - moved.familiarity).toBeLessThanOrEqual(
      MAX_DIMENSION_DELTA_PER_INTERACTION + 1e-9,
    );
  });

  it('keeps every dimension inside 0–1 under sustained extremes', () => {
    const hammered = replay(relationshipAt(), mixed(500, 400));

    for (const value of Object.values(hammered.dimensions)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });

  it('produces no delta larger than the ceiling for any signal shape', () => {
    const intents = [
      'question', 'request', 'statement', 'planning',
      'emotional_support', 'casual', 'correction', 'unknown',
    ] as const;

    for (const intent of intents) {
      for (const corrected of [true, false]) {
        for (const acknowledgedUncertainty of [true, false]) {
          const deltas = deltasFor(
            signalAt(1, { intent, corrected, acknowledgedUncertainty, exchangeTurns: 50 }),
          );

          const applied = applyDeltas(relationshipAt().dimensions, deltas);
          for (const axis of ['trust', 'familiarity', 'warmth', 'reliance'] as const) {
            const moved = Math.abs(applied[axis] - relationshipAt().dimensions[axis]);
            expect(moved).toBeLessThanOrEqual(MAX_DIMENSION_DELTA_PER_INTERACTION + 1e-9);
          }
        }
      }
    }
  });
});

describe('honesty outweighs being wrong', () => {
  it('leaves trust ahead when the companion admits uncertainty and is corrected', () => {
    const start = relationshipAt();
    const { relationship } = advance(
      start,
      signalAt(1, { corrected: true, acknowledgedUncertainty: true }),
    );

    // `honesty` is identity's highest-precedence value. A companion that says
    // "I do not know" and is then corrected should end slightly ahead.
    expect(relationship.dimensions.trust).toBeGreaterThan(start.dimensions.trust);
  });

  it('costs trust when the companion is corrected without having flagged doubt', () => {
    const start = relationshipAt();
    const confidentlyWrong = advance(
      start,
      signalAt(1, { intent: 'correction', corrected: true }),
    ).relationship;

    expect(confidentlyWrong.dimensions.trust).toBeLessThan(start.dimensions.trust);
  });
});

describe('counters record kinds, never content', () => {
  it('increments only the matching counter', () => {
    const after = countersAfter(relationshipAt().counters, signalAt(1, { intent: 'request' }));

    expect(after.requestsHandled).toBe(1);
    expect(after.plansSupported).toBe(0);
    expect(after.correctionsReceived).toBe(0);
  });

  it('counts a correction from either the intent or the flag', () => {
    const base = relationshipAt().counters;

    expect(countersAfter(base, signalAt(1, { intent: 'correction' })).correctionsReceived).toBe(1);
    expect(countersAfter(base, signalAt(1, { corrected: true })).correctionsReceived).toBe(1);
    // Not double-counted when both are present.
    expect(
      countersAfter(base, signalAt(1, { intent: 'correction', corrected: true }))
        .correctionsReceived,
    ).toBe(1);
  });
});

describe('elapsed arithmetic', () => {
  it('never returns a negative span, whatever the clock skew', () => {
    expect(daysBetween(dayOffset(10), dayOffset(1))).toBe(0);
  });

  it('returns zero rather than throwing on an unparseable timestamp', () => {
    expect(daysBetween('not-a-date', dayOffset(1))).toBe(0);
    expect(daysBetween(dayOffset(1), 'not-a-date')).toBe(0);
  });

  it('reports no cadence at all before there is an interval', () => {
    expect(averageGapDays(dayOffset(0), dayOffset(0), 1)).toBe(Number.POSITIVE_INFINITY);
    expect(averageGapDays(dayOffset(0), dayOffset(0), 0)).toBe(Number.POSITIVE_INFINITY);
  });

  it('counts intervals rather than events', () => {
    // Five interactions over four days bound four gaps of one day each.
    expect(averageGapDays(dayOffset(0), dayOffset(4), 5)).toBe(1);
  });
});
