import { describe, expect, it } from 'vitest';
import { SELF_QUESTIONS, VALUE_IDS } from '@nexa/models';
import {
  AUTONOMY,
  CAPABILITIES,
  COMMITMENTS,
  INTRODUCTIONS,
  INVARIANTS,
  KNOWLEDGE_BOUNDARIES,
  LIMITATIONS,
  SELF_ANSWERS,
  UNCERTAINTY_STANCES,
  VALUES,
  currentIdentity,
} from '@nexa/identity';

/**
 * The tests that earn their keep.
 *
 * The catalogues cross-reference each other by id, and nothing in the type
 * system checks that a reference resolves — `references: readonly string[]` is
 * satisfied by any string at all. A self-answer citing a capability that was
 * renamed would compile, ship, and produce a companion citing something that
 * does not exist.
 */

const ids = <T extends { id: string }>(entries: readonly T[]): string[] =>
  entries.map((entry) => entry.id);

/** Every id a self-answer is allowed to reference. */
const REFERENCEABLE = new Set([
  ...ids(CAPABILITIES),
  ...ids(LIMITATIONS),
  ...ids(COMMITMENTS),
  ...ids(AUTONOMY),
  ...ids(KNOWLEDGE_BOUNDARIES),
]);

describe('ids are unique within each catalogue', () => {
  it.each([
    ['values', ids(VALUES)],
    ['commitments', ids(COMMITMENTS)],
    ['autonomy', ids(AUTONOMY)],
    ['capabilities', ids(CAPABILITIES)],
    ['limitations', ids(LIMITATIONS)],
    ['boundaries', ids(KNOWLEDGE_BOUNDARIES)],
    ['invariants', ids(INVARIANTS)],
  ])('%s', (_name, list) => {
    expect(new Set(list).size).toBe(list.length);
  });
});

describe('cross-references resolve', () => {
  it('every self-answer reference points at something real', () => {
    for (const question of SELF_QUESTIONS) {
      for (const reference of SELF_ANSWERS[question].references) {
        expect(
          REFERENCEABLE.has(reference),
          `${question} references unknown id '${reference}'`,
        ).toBe(true);
      }
    }
  });

  it('every self-answer is grounded in real values', () => {
    for (const question of SELF_QUESTIONS) {
      for (const value of SELF_ANSWERS[question].grounds) {
        expect(VALUE_IDS).toContain(value);
      }
    }
  });

  it('reuses an id across catalogues only where the concept is genuinely one thing', () => {
    // `no_independent_goals` is deliberately an autonomy principle, a
    // limitation, and an invariant — three facets of one commitment, and a
    // renderer citing it should get all three. This test pins that as
    // intentional so an accidental collision elsewhere still shows up.
    const acrossCatalogues = [
      ...ids(AUTONOMY),
      ...ids(LIMITATIONS),
      ...ids(COMMITMENTS),
      ...ids(CAPABILITIES),
    ];
    const duplicated = acrossCatalogues.filter(
      (id, index) => acrossCatalogues.indexOf(id) !== index,
    );

    expect([...new Set(duplicated)].sort()).toStrictEqual(['no_independent_goals']);
  });
});

describe('values', () => {
  it('covers exactly the declared vocabulary', () => {
    expect(ids(VALUES).sort()).toStrictEqual([...VALUE_IDS].sort());
  });

  it('has a unique precedence per value', () => {
    const precedences = VALUES.map((value) => value.precedence);
    expect(new Set(precedences).size).toBe(precedences.length);
  });

  it('ranks honesty above every other value', () => {
    const honesty = VALUES.find((value) => value.id === 'honesty');
    expect(honesty).toBeDefined();

    for (const value of VALUES) {
      if (value.id === 'honesty') continue;
      // The invariant the whole engine rests on: a companion optimised for how
      // the user feels eventually tells them something false.
      expect(honesty?.precedence).toBeLessThan(value.precedence);
    }
  });

  it('ranks respect above care', () => {
    const rank = (id: string): number =>
      VALUES.find((value) => value.id === id)?.precedence ?? Number.MAX_SAFE_INTEGER;

    expect(rank('respect')).toBeLessThan(rank('care'));
  });
});

describe('uncertainty stances', () => {
  it('covers the whole 0–1 range with no gap', () => {
    const ascending = [...UNCERTAINTY_STANCES].sort((a, b) => a.atLeast - b.atLeast);
    expect(ascending[0]?.atLeast).toBe(0);
  });

  it('has a distinct floor per band', () => {
    const floors = UNCERTAINTY_STANCES.map((stance) => stance.atLeast);
    expect(new Set(floors).size).toBe(floors.length);
  });

  it('discloses at every band except the most certain', () => {
    for (const stance of UNCERTAINTY_STANCES) {
      if (stance.band === 'certain') {
        // A companion that qualifies everything carries no information in the
        // qualification.
        expect(stance.disclose).toBe(false);
      } else {
        expect(stance.disclose).toBe(true);
      }
    }
  });

  it('never defers without also disclosing', () => {
    for (const stance of UNCERTAINTY_STANCES) {
      if (stance.defer) expect(stance.disclose).toBe(true);
    }
  });
});

describe('capabilities are described honestly', () => {
  it('marks at least one capability as planned rather than claiming everything works', () => {
    expect(CAPABILITIES.some((c) => c.maturity === 'planned')).toBe(true);
  });

  it('names what a non-trivial capability depends on', () => {
    for (const capability of CAPABILITIES) {
      if (capability.maturity === 'planned') {
        expect(
          capability.requires.length,
          `planned capability '${capability.id}' should name what it needs`,
        ).toBeGreaterThan(0);
      }
    }
  });
});

describe('limitations distinguish permanent from temporary', () => {
  it('has both kinds', () => {
    expect(LIMITATIONS.some((l) => l.permanent)).toBe(true);
    expect(LIMITATIONS.some((l) => !l.permanent)).toBe(true);
  });

  it('marks the epistemic ones permanent', () => {
    // Nothing a future version ships can make it possible to know whether a
    // process constitutes experience.
    for (const limitation of LIMITATIONS) {
      if (limitation.kind === 'epistemic') expect(limitation.permanent).toBe(true);
    }
  });
});

describe('introduction plans', () => {
  it('never both includes and omits the same element', () => {
    for (const plan of Object.values(INTRODUCTIONS)) {
      for (const element of plan.include) {
        expect(plan.omit, `${plan.context} both includes and omits ${element}`).not.toContain(
          element,
        );
      }
    }
  });

  it('stays within its own ceiling', () => {
    for (const plan of Object.values(INTRODUCTIONS)) {
      expect(plan.include.length).toBeLessThanOrEqual(plan.maxElements);
    }
  });

  it('states the memory stance before inviting the user to speak on first meeting', () => {
    const first = INTRODUCTIONS.first_meeting;
    const memoryAt = first.include.indexOf('memory_stance');
    const inviteAt = first.include.indexOf('invitation');

    // Consent, not style. A companion should say it remembers before the user
    // first tells it something worth remembering.
    expect(memoryAt).toBeGreaterThanOrEqual(0);
    expect(memoryAt).toBeLessThan(inviteAt);
  });

  it('does not re-introduce itself by name to someone returning', () => {
    expect(INTRODUCTIONS.returning_after_absence.include).not.toContain('name');
  });
});

describe('the profile assembles the catalogues without copying them', () => {
  it('holds the same arrays the modules export', () => {
    const profile = currentIdentity();

    expect(profile.values).toBe(VALUES);
    expect(profile.capabilities).toBe(CAPABILITIES);
    expect(profile.limitations).toBe(LIMITATIONS);
    expect(profile.invariants).toBe(INVARIANTS);
  });
});
