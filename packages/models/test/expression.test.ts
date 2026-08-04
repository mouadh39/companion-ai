import { describe, expect, it } from 'vitest';
import type { ExpressionProfile } from '@nexa/models';
import {
  DETAIL_LEVELS,
  DETAIL_RANK,
  EXPRESSION_DIMENSIONS,
  EXPRESSION_REASON_CODES,
  INITIATIVE_LEVELS,
  INITIATIVE_RANK,
  PACINGS,
  PACING_RANK,
  TRAIT_NAMES,
  defaultPersonality,
  isValidExpression,
} from '@nexa/models';

const profile = (overrides: Partial<ExpressionProfile> = {}): ExpressionProfile => ({
  tone: 'neutral',
  detail: 'moderate',
  initiative: 'follow',
  pacing: 'measured',
  curiosity: 0.5,
  humor: 0.5,
  emotionalExpression: 0.5,
  warmth: 0.5,
  formality: 0.5,
  directness: 0.5,
  energy: 0.5,
  boundaries: [],
  rationale: [],
  ...overrides,
});

describe('isValidExpression', () => {
  it('accepts a profile whose dimensions are all within 0–1', () => {
    expect(isValidExpression(profile())).toBe(true);
  });

  it('accepts the bounds themselves', () => {
    expect(isValidExpression(profile({ humor: 0, warmth: 1 }))).toBe(true);
  });

  it.each([
    ['below zero', { humor: -0.01 }],
    ['above one', { warmth: 1.01 }],
    ['not finite', { energy: Number.POSITIVE_INFINITY }],
    ['NaN', { curiosity: Number.NaN }],
  ])('rejects a dimension that is %s', (_label, overrides) => {
    expect(isValidExpression(profile(overrides))).toBe(false);
  });
});

describe('stepped vocabularies', () => {
  it.each([
    ['detail', DETAIL_LEVELS, DETAIL_RANK],
    ['initiative', INITIATIVE_LEVELS, INITIATIVE_RANK],
    ['pacing', PACINGS, PACING_RANK],
  ])('%s ranks agree with array order', (_name, levels, ranks) => {
    const typedLevels = levels as readonly string[];
    const typedRanks = ranks as Readonly<Record<string, number>>;

    typedLevels.forEach((level, index) => {
      expect(typedRanks[level]).toBe(index);
    });
    expect(Object.keys(typedRanks)).toHaveLength(typedLevels.length);
  });
});

describe('vocabulary completeness', () => {
  it('lists every dimension of the profile', () => {
    // The compile-time guard in `expression.ts` proves the union is covered.
    // This proves the runtime object matches it, which is the half a type
    // cannot check — a field renamed in the interface but not here would pass
    // the type check and produce a rationale naming a dimension that no longer
    // exists.
    const structural = Object.keys(profile()).filter(
      (key) => key !== 'boundaries' && key !== 'rationale',
    );

    expect([...EXPRESSION_DIMENSIONS].sort()).toStrictEqual(structural.sort());
  });

  it('has no duplicate reason codes', () => {
    expect(new Set(EXPRESSION_REASON_CODES).size).toBe(EXPRESSION_REASON_CODES.length);
  });
});

describe('trait vocabulary', () => {
  it('gives the default personality a value for every trait', () => {
    const { traits } = defaultPersonality();

    for (const name of TRAIT_NAMES) {
      expect(traits[name]).toBeTypeOf('number');
      expect(traits[name]).toBeGreaterThanOrEqual(0);
      expect(traits[name]).toBeLessThanOrEqual(1);
    }
    expect(Object.keys(traits)).toHaveLength(TRAIT_NAMES.length);
  });

  it('keeps `energy` out of the traits — it is adaptive state', () => {
    // Two sources of truth for one quantity is the defect this prevents. The
    // engine reads energy from `adaptive`, and a trait of the same name would
    // give a second value that nothing keeps in step.
    expect(TRAIT_NAMES).not.toContain('energy');
    expect(defaultPersonality().adaptive.energy).toBeTypeOf('number');
  });
});
