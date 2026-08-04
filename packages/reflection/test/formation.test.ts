import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, policyFor, reflect } from '@nexa/reflection';
import {
  USER,
  at,
  firstFormed,
  formations,
  interactiveTechnology,
  memoryOf,
  only,
  overworkWeek,
} from './fixtures.js';

const pass = (memories: readonly ReturnType<typeof memoryOf>[], day = 30) =>
  reflect({ userId: USER, memories, existing: [], at: at(day) });

describe('the examples from the brief', () => {
  it('rolls three separate enthusiasms into one generalisation', () => {
    const draft = firstFormed(pass(interactiveTechnology()));

    expect(draft.kind).toBe('interest');
    expect(draft.topic).toBe('building interactive technology');
    expect(draft.statement).toBe('The user may enjoy building interactive technology.');
    expect(draft.supporting).toHaveLength(3);
  });

  it('notices overwork without ever diagnosing it', () => {
    const draft = firstFormed(pass(overworkWeek(), 3));

    expect(draft.kind).toBe('condition');
    expect(draft.statement).toBe('The user may currently be overworking.');
    // The whole point of the example. Nothing in the vocabulary can say this.
    expect(draft.statement).not.toMatch(/burn|burnout|depress|diagnos/iu);
  });
});

describe('generalising requires breadth, not repetition', () => {
  it('refuses to generalise from three remarks about one thing', () => {
    // The single most important decline in the engine. Three memories clear the
    // count gate; none of them is about anything but Unity, so nothing supports
    // the broader claim.
    const declines = only(
      pass([
        memoryOf('I enjoy Unity.', 0),
        memoryOf('I enjoy Unity a great deal, honestly.', 10),
        memoryOf('Unity is fun to use in the evening.', 20),
      ]),
      'decline',
    );

    const breadth = declines.find(
      (decision) =>
        decision.outcome === 'decline' && decision.reason === 'insufficient_breadth',
    );
    expect(breadth).toBeDefined();
  });

  it('keeps the user’s own word when no theme matches', () => {
    // No lexicon entry for chess, so the claim stays exactly as narrow as the
    // evidence. It never becomes "strategy games".
    const draft = firstFormed(
      pass([
        memoryOf('I enjoy chess.', 0),
        memoryOf('Chess is fun.', 8),
        memoryOf('I am into chess.', 16),
      ]),
    );

    expect(draft.topicKey).toBe('literal:chess');
    expect(draft.statement).toBe('The user may enjoy chess.');
  });

  it('generalises once the evidence is about several things', () => {
    const draft = firstFormed(pass(interactiveTechnology()));
    expect(draft.topicKey).toBe('theme:interactive-technology');
  });
});

describe('the gates', () => {
  it('forms nothing from a single remark', () => {
    expect(formations(pass([memoryOf('I enjoy Unity.', 0)]))).toHaveLength(0);
  });

  it('counts one remark said twice as one remark', () => {
    const restated = pass([
      memoryOf('I prefer short answers.', 0),
      memoryOf('I prefer shorter answers.', 5),
    ]);

    const decline = only(restated, 'decline').find(
      (decision) =>
        decision.outcome === 'decline' && decision.reason === 'evidence_not_distinct',
    );
    expect(decline).toBeDefined();
    expect(formations(restated)).toHaveLength(0);
  });

  it('refuses a habit seen only within one afternoon', () => {
    const sameDay = pass(
      [
        memoryOf('I usually work in the morning.', 0),
        memoryOf('I tend to start at 6am, before anything else.', 0),
        memoryOf('I always get up at sunrise these days.', 0),
      ],
      1,
    );

    const decline = only(sameDay, 'decline').find(
      (decision) =>
        decision.outcome === 'decline' && decision.reason === 'insufficient_spread',
    );
    expect(decline).toBeDefined();
  });

  it('forms the same habit once it has spread across weeks', () => {
    const spread = pass(
      [
        memoryOf('I usually work in the morning.', 0),
        memoryOf('I tend to start at 6am, before anything else.', 12),
        memoryOf('I always get up at sunrise these days.', 25),
        memoryOf('I often begin at dawn now.', 35),
      ],
      40,
    );

    const draft = firstFormed(spread);
    expect(draft.kind).toBe('habit');
    expect(draft.topic).toBe('early mornings');
  });

  it('states every threshold it applied, even when it declines', () => {
    const declined = only(pass([memoryOf('I enjoy Unity.', 0)]), 'decline')[0];

    expect(declined).toBeDefined();
    // A threshold nobody can read is a threshold nobody can tune.
    expect(declined?.reasons.length).toBeGreaterThan(0);
    expect(declined?.reasons.some((reason) => reason.code === 'below_threshold')).toBe(true);
  });
});

describe('what may not be evidence', () => {
  it('never reflects on its own conclusions', () => {
    // Without this rule an insight persisted as a reflective memory feeds the
    // next pass, strengthens itself, and is persisted again — confidence
    // growing with nothing having happened.
    const derived = interactiveTechnology().map((memory) => ({
      ...memory,
      source: 'reflection' as const,
    }));

    expect(formations(pass(derived))).toHaveLength(0);
  });

  it('excludes reflective memories by type as well as by source', () => {
    const derived = interactiveTechnology().map((memory) => ({
      ...memory,
      type: 'reflective' as const,
    }));

    expect(formations(pass(derived))).toHaveLength(0);
  });

  it('ignores memories the companion is not sure of', () => {
    const shaky = interactiveTechnology().map((memory) => ({
      ...memory,
      confidence: 0.2 as never,
    }));

    expect(formations(pass(shaky))).toHaveLength(0);
  });

  it('ignores expired memories', () => {
    const stale = interactiveTechnology().map((memory) => ({
      ...memory,
      expiresAt: at(5),
    }));

    expect(formations(pass(stale, 30))).toHaveLength(0);
  });

  it('cannot see evidence from after the moment it is asked about', () => {
    // The replay guard. Reflecting as of March must not use April's memories,
    // or replaying a history would produce insights the user never earned.
    expect(formations(pass(interactiveTechnology(), 5))).toHaveLength(0);
    expect(formations(pass(interactiveTechnology(), 30))).toHaveLength(1);
  });

  it('reports what it excluded and why', () => {
    const derived = interactiveTechnology().map((memory) => ({
      ...memory,
      source: 'reflection' as const,
    }));
    const result = reflect({ userId: USER, memories: derived, existing: [], at: at(30) });

    const excluded = result.reasons.find((reason) => reason.code === 'evidence_excluded');
    expect(excluded?.detail).toContain('derived');
  });
});

describe('two axes, and they guard each other', () => {
  it('reads a holiday as a holiday', () => {
    // "weekend" is an overwork marker and there is no condition marker here.
    // A single-axis matcher would read three cheerful messages as exhaustion.
    const holiday = pass([
      memoryOf('We are going away this weekend.', 0),
      memoryOf('The weekend away was lovely.', 3),
      memoryOf('Another weekend trip is booked.', 6),
    ]);

    expect(
      formations(holiday).some((draft) => draft.kind === 'condition'),
    ).toBe(false);
  });

  it('needs a topic as well as a claim', () => {
    // A marker with nothing to be about produces no observation at all.
    expect(formations(pass([memoryOf('I prefer.', 0), memoryOf('I prefer!', 4)]))).toHaveLength(0);
  });
});

describe('capacity', () => {
  it('forms only so much at once, and says so', () => {
    const many = Array.from({ length: 12 }, (_, index) => [
      memoryOf(`I enjoy topic${index}.`, index),
      memoryOf(`topic${index} is fun.`, index + 30),
      memoryOf(`I am into topic${index}.`, index + 60),
    ]).flat();

    const result = reflect({ userId: USER, memories: many, existing: [], at: at(200) });

    expect(formations(result).length).toBeLessThanOrEqual(
      DEFAULT_CONFIG.maxFormationsPerPass,
    );
    expect(
      only(result, 'decline').some(
        (decision) => decision.outcome === 'decline' && decision.reason === 'pass_capacity',
      ),
    ).toBe(true);
  });
});

describe('the policy table is coherent', () => {
  it('never lets a kind saturate at its own minimum', () => {
    // If it did, an insight would arrive at its final confidence the instant it
    // cleared the gate and could never grow surer.
    for (const kind of Object.keys(DEFAULT_CONFIG.kinds) as (keyof typeof DEFAULT_CONFIG.kinds)[]) {
      const policy = policyFor(kind);
      expect(policy.saturationEvidence).toBeGreaterThan(policy.minEvidence);
      expect(policy.stableEvidence).toBeGreaterThanOrEqual(policy.saturationEvidence);
    }
  });

  it('gives every theme-only kind at least one theme that licenses it', () => {
    for (const kind of Object.keys(DEFAULT_CONFIG.kinds) as (keyof typeof DEFAULT_CONFIG.kinds)[]) {
      if (!policyFor(kind).requiresTheme) continue;
      expect(
        DEFAULT_CONFIG.themes.some((theme) => theme.kinds.includes(kind)),
        `no theme licenses '${kind}', so it can never form`,
      ).toBe(true);
    }
  });

  it('makes every kind mortal', () => {
    // Understanding that is never re-earned has stopped tracking the person.
    for (const kind of Object.keys(DEFAULT_CONFIG.kinds) as (keyof typeof DEFAULT_CONFIG.kinds)[]) {
      expect(policyFor(kind).ttlDays).toBeGreaterThan(0);
      expect(policyFor(kind).stalenessDays).toBeLessThanOrEqual(policyFor(kind).ttlDays);
    }
  });
});
