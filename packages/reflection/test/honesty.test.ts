import { describe, expect, it } from 'vitest';
import type { InsightCertainty, InsightEvidence, InsightPolarity } from '@nexa/models';
import { INSIGHT_CERTAINTIES, INSIGHT_KINDS, INSIGHT_POLARITIES } from '@nexa/models';
import {
  CERTAINTY_CEILING,
  CONFIDENT_AT,
  DEFAULT_CONFIG,
  bandFor,
  policyFor,
  reflect,
  score,
  statementFor,
} from '@nexa/reflection';
import { USER, at, firstFormed, memoryOf, overworkWeek } from './fixtures.js';

/** The best evidence anyone could possibly have: saturated, perfect, unanimous. */
const idealEvidence = (count: number): readonly InsightEvidence[] =>
  Array.from({ length: count }, (_, index) => ({
    memoryId: `mem-${index}` as InsightEvidence['memoryId'],
    at: at(index * 10),
    source: 'user_stated' as const,
    polarity: 'affirms' as const,
    weight: 1,
  }));

describe('reflection is never certain', () => {
  it('cannot exceed the absolute ceiling for any kind, at any volume', () => {
    for (const kind of INSIGHT_KINDS) {
      const policy = policyFor(kind);
      const scored = score(policy, idealEvidence(500), [], 10_000, 0);

      expect(scored.confidence).toBeLessThanOrEqual(CERTAINTY_CEILING);
      expect(scored.confidence).toBeLessThanOrEqual(policy.ceiling);
      expect(scored.confidence).toBeLessThan(1);
    }
  });

  it('has no band above "confident"', () => {
    expect([...INSIGHT_CERTAINTIES]).not.toContain('certain');
    expect(bandFor(1)).toBe('confident');
  });

  it('lets a well-earned claim reach "confident" all the same', () => {
    // A ceiling that nothing could ever approach would make the whole scale
    // decorative, and a companion that hedges everything equally says nothing.
    const reachable = INSIGHT_KINDS.filter(
      (kind) => score(policyFor(kind), idealEvidence(50), [], 1_000, 0).confidence >= CONFIDENT_AT,
    );

    expect(reachable.length).toBeGreaterThan(0);
  });
});

describe('reflection never diagnoses', () => {
  it('caps a present-state claim below the confident band', () => {
    const scored = score(policyFor('condition'), idealEvidence(500), [], 10_000, 0);
    expect(scored.confidence).toBeLessThan(CONFIDENT_AT);
    expect(scored.certainty).not.toBe('confident');
  });

  it('hedges a present-state claim at every band, including one it cannot reach', () => {
    // Belt and braces. The ceiling is tuning; this is the promise.
    const policy = policyFor('condition');
    for (const certainty of INSIGHT_CERTAINTIES) {
      const statement = statementFor(policy, certainty, 'affirms', 'overworking');
      expect(statement).toMatch(/\bmay\b|\bappears to\b/u);
    }
  });

  it('has no diagnostic vocabulary to reach for', () => {
    // The structural version of the rule: the lexicon contains no condition a
    // person could be *in*, only things they could be *doing*.
    const conditions = DEFAULT_CONFIG.themes.filter((theme) => theme.kinds.includes('condition'));

    expect(conditions.length).toBeGreaterThan(0);
    for (const theme of conditions) {
      expect(theme.label).not.toMatch(
        /burn(t|ed)? ?out|depress|anxious|anxiety|ill|unwell|disorder|breakdown/iu,
      );
    }
  });

  it('says the hedged thing and not the diagnosis', () => {
    const draft = firstFormed(
      reflect({ userId: USER, memories: overworkWeek(), existing: [], at: at(3) }),
    );

    expect(draft.statement).toBe('The user may currently be overworking.');
  });
});

describe('every sentence it can say is written down', () => {
  it('produces a well-formed statement for every kind, band and direction', () => {
    for (const kind of INSIGHT_KINDS) {
      for (const certainty of INSIGHT_CERTAINTIES as readonly InsightCertainty[]) {
        for (const polarity of INSIGHT_POLARITIES as readonly InsightPolarity[]) {
          const statement = statementFor(policyFor(kind), certainty, polarity, 'chess');

          expect(statement.startsWith('The user')).toBe(true);
          expect(statement.endsWith('.')).toBe(true);
          expect(statement).toContain('chess');
          expect(statement).not.toContain('{');
        }
      }
    }
  });

  it('never states a claim as fact', () => {
    for (const kind of INSIGHT_KINDS) {
      for (const certainty of INSIGHT_CERTAINTIES) {
        for (const polarity of INSIGHT_POLARITIES) {
          expect(statementFor(policyFor(kind), certainty, polarity, 'chess')).not.toMatch(
            /\bcertainly\b|\bdefinitely\b|\bobviously\b|\bclearly\b|\bwithout doubt\b/iu,
          );
        }
      }
    }
  });

  it('phrases a difficulty as being about a thing, not about a person', () => {
    for (const certainty of INSIGHT_CERTAINTIES) {
      const statement = statementFor(policyFor('struggle'), certainty, 'affirms', 'shaders');
      expect(statement).toContain('difficulty with');
      expect(statement).not.toMatch(/\bbad at\b|\bpoor at\b|\bincapable\b|\bfails\b/iu);
    }
  });
});

describe('an insight is not a memory', () => {
  it('holds no memory content, only references', () => {
    // An insight that cached excerpts would survive the deletion of what it
    // quotes, and the user's right to delete would be half a promise.
    const draft = firstFormed(
      reflect({ userId: USER, memories: overworkWeek(), existing: [], at: at(3) }),
    );

    for (const entry of draft.supporting) {
      expect(Object.keys(entry).sort()).toStrictEqual([
        'at',
        'memoryId',
        'polarity',
        'source',
        'weight',
      ]);
    }
    expect(JSON.stringify(draft)).not.toContain('stayed awake');
  });

  it('records which ruleset produced it', () => {
    const draft = firstFormed(
      reflect({ userId: USER, memories: overworkWeek(), existing: [], at: at(3) }),
    );

    expect(draft.provenance.ruleset).toBe(DEFAULT_CONFIG.ruleset);
  });

  it('can explain itself from the record alone', () => {
    const decision = reflect({
      userId: USER,
      memories: overworkWeek(),
      existing: [],
      at: at(3),
    }).decisions.find((entry) => entry.outcome === 'form');

    expect(decision?.reasons.some((reason) => reason.code === 'confidence_scored')).toBe(true);
    expect(
      decision?.reasons.find((reason) => reason.code === 'confidence_scored')?.detail,
    ).toContain('×');
  });
});

describe('a bad lexicon cannot make it reckless', () => {
  it('honours a caller’s themes without abandoning the gates', () => {
    const reckless = {
      ...DEFAULT_CONFIG,
      themes: [
        {
          id: 'everything',
          label: 'absolutely everything',
          kinds: [...INSIGHT_KINDS],
          markers: ['chess', 'unity', 'coriander', 'morning'],
        },
      ],
      ruleset: 'test/reckless',
    };

    const result = reflect({
      userId: USER,
      memories: [memoryOf('I enjoy chess.', 0)],
      existing: [],
      at: at(30),
      config: reckless,
    });

    // One memory is one memory, whatever the lexicon says it means.
    expect(result.decisions.every((decision) => decision.outcome === 'decline')).toBe(true);
  });
});
