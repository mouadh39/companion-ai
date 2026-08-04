import { describe, expect, it } from 'vitest';
import { OBSERVATION_DIMENSIONS } from '@nexa/models';
import { TENSION_FLOOR, policyFor, stanceFor, tensionsIn } from '@nexa/perception';
import { allOn, on, read } from './fixtures.js';

describe('people are allowed to be more than one thing', () => {
  it('reports two emotions at once without choosing', () => {
    const outcome = read('I am so happy it finally works, but I am exhausted.');

    expect(stanceFor(outcome, 'joy')).toBe('observed');
    expect(stanceFor(outcome, 'fatigue')).toBe('observed');
  });

  it('produces no summary, no primary emotion and no single intent', () => {
    // The absence is the design. Every one of those is an interpretation, and
    // interpretations belong to whoever is deciding.
    const outcome = read('I am so happy it finally works, but I am exhausted.');

    expect(outcome).not.toHaveProperty('mood');
    expect(outcome).not.toHaveProperty('primaryEmotion');
    expect(outcome).not.toHaveProperty('intent');
    expect(outcome).not.toHaveProperty('summary');
  });

  it('leaves both confidences untouched by the disagreement', () => {
    // A tension is a report about a pair, not an adjustment to either.
    // Disagreement between two readings is not evidence against either one.
    const alone = on(read('I am delighted.'), 'joy');
    const conflicted = on(read('I am delighted. I am also miserable.'), 'joy');

    expect(conflicted?.confidence).toBe(alone?.confidence);
  });
});

describe('tensions are reported, never resolved', () => {
  it('names an opposed pair that both showed up', () => {
    const outcome = read('I am delighted. I am also miserable.');

    expect(outcome.tensions).toHaveLength(1);
    expect([...(outcome.tensions[0]?.dimensions ?? [])].sort()).toStrictEqual(['joy', 'sadness']);
  });

  it('keeps both observations in the outcome', () => {
    const outcome = read('I am delighted. I am also miserable.');

    expect(stanceFor(outcome, 'joy')).toBe('observed');
    expect(stanceFor(outcome, 'sadness')).toBe('observed');
  });

  it('notices agreeing and disagreeing in the same breath', () => {
    const outcome = read("Yes, exactly — but I don't think that works.");

    expect(
      outcome.tensions.some((tension) =>
        [...tension.dimensions].sort().join('|') === 'agreement|disagreement',
      ),
    ).toBe(true);
  });

  it('notices hedging and committing in the same message', () => {
    const outcome = read('That is definitely the cause. Maybe. I am not sure.');

    expect(
      outcome.tensions.some((tension) =>
        [...tension.dimensions].sort().join('|') === 'certainty|uncertainty',
      ),
    ).toBe(true);
  });

  it('reports each pair once, not twice', () => {
    const outcome = read('I am delighted. I am also miserable.');
    const keys = outcome.tensions.map((tension) => [...tension.dimensions].sort().join('|'));

    expect(new Set(keys).size).toBe(keys.length);
  });

  it('ignores pairs too faint to matter', () => {
    expect(tensionsIn([])).toStrictEqual([]);
    expect(TENSION_FLOOR).toBeGreaterThan(0);
  });

  it('does not call two channels agreeing a tension', () => {
    const outcome = read('I am frustrated and annoyed and fed up.');

    expect(allOn(outcome, 'frustration').length).toBeGreaterThan(0);
    expect(outcome.tensions).toStrictEqual([]);
  });

  it('explains itself', () => {
    const outcome = read('I am delighted. I am also miserable.');

    expect(outcome.tensions[0]?.detail).toContain('neither was suppressed');
    expect(outcome.reasons.some((reason) => reason.code === 'tension_found')).toBe(true);
  });
});

describe('the opposition table is coherent', () => {
  it('is symmetric', () => {
    for (const dimension of OBSERVATION_DIMENSIONS) {
      const opposite = policyFor(dimension).opposes;
      if (opposite === null) continue;
      expect(policyFor(opposite).opposes, `'${dimension}' ↔ '${opposite}'`).toBe(dimension);
    }
  });

  it('never opposes a dimension to itself', () => {
    for (const dimension of OBSERVATION_DIMENSIONS) {
      expect(policyFor(dimension).opposes).not.toBe(dimension);
    }
  });

  it('only opposes dimensions within one family', () => {
    // A tension between "verbose" and "sad" would be a category error dressed
    // as an insight.
    for (const dimension of OBSERVATION_DIMENSIONS) {
      const opposite = policyFor(dimension).opposes;
      if (opposite === null) continue;
      expect(policyFor(opposite).family).toBe(policyFor(dimension).family);
    }
  });
});
