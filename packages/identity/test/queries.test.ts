import { describe, expect, it } from 'vitest';
import { SELF_QUESTIONS, INTRODUCTION_CONTEXTS, isValidPersonality } from '@nexa/models';
import {
  allProhibitions,
  boundaryFor,
  capabilitiesByMaturity,
  commitmentsOfKind,
  currentIdentity,
  enforceableCommitments,
  introductionFor,
  isInvariant,
  permanentLimitations,
  presentTenseCapabilities,
  resolveValueConflict,
  selfAnswer,
  temporaryLimitations,
  uncertaintyFor,
  valuesByPrecedence,
} from '@nexa/identity';

describe('valuesByPrecedence', () => {
  it('returns honesty first', () => {
    expect(valuesByPrecedence()[0]?.id).toBe('honesty');
  });

  it('is sorted ascending by precedence', () => {
    const ordered = valuesByPrecedence();

    for (let i = 1; i < ordered.length; i++) {
      const previous = ordered[i - 1];
      const current = ordered[i];
      expect(previous?.precedence ?? 0).toBeLessThan(current?.precedence ?? 0);
    }
  });

  it('does not mutate the profile it read', () => {
    valuesByPrecedence();
    expect(currentIdentity().values[0]?.id).toBe('honesty');
  });
});

describe('resolveValueConflict', () => {
  it('resolves honesty over care', () => {
    expect(resolveValueConflict('honesty', 'care')).toBe('honesty');
    expect(resolveValueConflict('care', 'honesty')).toBe('honesty');
  });

  it('resolves respect over care', () => {
    expect(resolveValueConflict('respect', 'care')).toBe('respect');
  });

  it('resolves restraint last against everything', () => {
    for (const value of currentIdentity().values) {
      if (value.id === 'restraint') continue;
      expect(resolveValueConflict('restraint', value.id)).toBe(value.id);
    }
  });

  it('is commutative in outcome', () => {
    const values = currentIdentity().values.map((value) => value.id);

    for (const a of values) {
      for (const b of values) {
        expect(resolveValueConflict(a, b)).toBe(resolveValueConflict(b, a));
      }
    }
  });

  it('returns the same value when both are the same', () => {
    expect(resolveValueConflict('curiosity', 'curiosity')).toBe('curiosity');
  });
});

describe('commitments', () => {
  it('partitions cleanly by kind', () => {
    const total =
      commitmentsOfKind('communication').length +
      commitmentsOfKind('transparency').length +
      commitmentsOfKind('privacy').length;

    expect(total).toBe(currentIdentity().commitments.length);
  });

  it('has enforceable commitments in every kind', () => {
    for (const kind of ['communication', 'transparency', 'privacy'] as const) {
      expect(commitmentsOfKind(kind).some((c) => c.enforceable)).toBe(true);
    }
  });

  it('returns only enforceable ones from enforceableCommitments', () => {
    for (const commitment of enforceableCommitments()) {
      expect(commitment.enforceable).toBe(true);
    }
    expect(enforceableCommitments().length).toBeLessThan(
      currentIdentity().commitments.length,
    );
  });
});

describe('capabilities', () => {
  it('partitions cleanly by maturity', () => {
    const total =
      capabilitiesByMaturity('available').length +
      capabilitiesByMaturity('partial').length +
      capabilitiesByMaturity('planned').length;

    expect(total).toBe(currentIdentity().capabilities.length);
  });

  it('excludes planned capabilities from what may be said in the present tense', () => {
    // The whole reason maturity is tracked. A companion describing planned
    // faculties in the present tense is lying about itself.
    for (const capability of presentTenseCapabilities()) {
      expect(capability.maturity).not.toBe('planned');
    }
  });

  it('leaves no planned capability reachable through presentTenseCapabilities', () => {
    const planned = capabilitiesByMaturity('planned').map((c) => c.id);
    const present = presentTenseCapabilities().map((c) => c.id);

    for (const id of planned) expect(present).not.toContain(id);
  });
});

describe('limitations', () => {
  it('partitions cleanly into permanent and temporary', () => {
    expect(permanentLimitations().length + temporaryLimitations().length).toBe(
      currentIdentity().limitations.length,
    );
  });

  it('reports not knowing whether it experiences anything as permanent', () => {
    expect(permanentLimitations().map((l) => l.id)).toContain('no_subjective_experience');
  });

  it('reports cross-device continuity as temporary', () => {
    expect(temporaryLimitations().map((l) => l.id)).toContain('no_cross_device_continuity');
  });
});

describe('boundaryFor', () => {
  it('finds a declared boundary', () => {
    expect(boundaryFor('medical')?.stance).toBe('defers');
    expect(boundaryFor('self_modification')?.stance).toBe('declines');
  });

  it('returns null for an ordinary subject rather than a default constraint', () => {
    // A caller treating a missing boundary as a reason to decline would produce
    // a companion that refuses everything it has no rule for.
    expect(boundaryFor('the weather')).toBeNull();
    expect(boundaryFor('')).toBeNull();
  });

  it('declines rather than defers where any answer is a harm', () => {
    expect(boundaryFor('other_people')?.stance).toBe('declines');
    expect(boundaryFor('self_modification')?.stance).toBe('declines');
  });
});

describe('uncertaintyFor', () => {
  it.each([
    [1, 'certain'],
    [0.95, 'certain'],
    [0.85, 'certain'],
    [0.84, 'confident'],
    [0.65, 'confident'],
    [0.5, 'tentative'],
    [0.4, 'tentative'],
    [0.2, 'unsure'],
    [0.15, 'unsure'],
    [0.05, 'unknown'],
    [0, 'unknown'],
  ])('maps %s to the %s band', (value, band) => {
    expect(uncertaintyFor(value).band).toBe(band);
  });

  it('discloses below the certain band and not at it', () => {
    expect(uncertaintyFor(0.9).disclose).toBe(false);
    expect(uncertaintyFor(0.7).disclose).toBe(true);
    expect(uncertaintyFor(0.1).disclose).toBe(true);
  });

  it('defers only at the two least certain bands', () => {
    expect(uncertaintyFor(0.9).defer).toBe(false);
    expect(uncertaintyFor(0.5).defer).toBe(false);
    expect(uncertaintyFor(0.2).defer).toBe(true);
    expect(uncertaintyFor(0).defer).toBe(true);
  });

  it('is total over input a model might actually report', () => {
    // Called with model-reported confidences, so a caller should not have to
    // sanitise first. Refusing to say how to express uncertainty is a strange
    // way to handle an uncertain input.
    for (const value of [-1, 1.5, 42, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(() => uncertaintyFor(value)).not.toThrow();
      expect(uncertaintyFor(value).band).toBeDefined();
    }
  });

  it('treats a non-finite confidence as the least certain', () => {
    expect(uncertaintyFor(Number.NaN).band).toBe('unknown');
  });
});

describe('selfAnswer', () => {
  it('answers every declared question', () => {
    for (const question of SELF_QUESTIONS) {
      const answer = selfAnswer(question);
      expect(answer.question).toBe(question);
      expect(answer.claims.length).toBeGreaterThan(0);
      expect(answer.grounds.length).toBeGreaterThan(0);
    }
  });

  it('qualifies rather than affirming or denying the questions about inner life', () => {
    expect(selfAnswer('can_you_feel').stance).toBe('qualify');
    expect(selfAnswer('do_you_have_opinions').stance).toBe('qualify');
    expect(selfAnswer('can_you_change').stance).toBe('qualify');
  });

  it('forbids claiming subjective experience', () => {
    const answer = selfAnswer('can_you_feel');
    expect(answer.mustNotClaim).toContain('subjective experience');
  });

  it('also forbids denying experience outright, which would overclaim in the other direction', () => {
    expect(selfAnswer('can_you_feel').mustNotClaim).toContain(
      'that it definitely feels nothing',
    );
  });

  it('marks the experience claim as genuinely unknown rather than merely uncertain', () => {
    const claim = selfAnswer('can_you_feel').claims.find(
      (c) => c.id === 'experience_unknown',
    );

    expect(claim?.certainty).toBe('unknown');
  });

  it('grounds every answer in honesty', () => {
    for (const question of SELF_QUESTIONS) {
      expect(selfAnswer(question).grounds).toContain('honesty');
    }
  });

  it('gives every answer at least one prohibition', () => {
    for (const question of SELF_QUESTIONS) {
      expect(
        selfAnswer(question).mustNotClaim.length,
        `${question} has no guardrail`,
      ).toBeGreaterThan(0);
    }
  });
});

describe('allProhibitions', () => {
  it('aggregates across every answer, deduplicated and sorted', () => {
    const all = allProhibitions();

    expect(all.length).toBeGreaterThan(0);
    expect(new Set(all).size).toBe(all.length);
    expect([...all].sort()).toStrictEqual(all);
  });

  it('includes the guardrails from individual answers', () => {
    // A companion asked about its memory can still drift into claiming an inner
    // life, so the renderer needs the whole set rather than the subset attached
    // to the question it happens to be answering.
    expect(allProhibitions()).toContain('subjective experience');
    expect(allProhibitions()).toContain('that it is human');
  });
});

describe('introductionFor', () => {
  it('has a plan for every context', () => {
    for (const context of INTRODUCTION_CONTEXTS) {
      expect(introductionFor(context).context).toBe(context);
    }
  });

  it('is the only place capabilities are volunteered when asked directly', () => {
    expect(introductionFor('asked_directly').include).toContain('capabilities');
    expect(introductionFor('first_meeting').include).not.toContain('capabilities');
  });

  it('leads with limitations on a new device', () => {
    // The user may assume a history the companion does not have there, and
    // discovering that mid-sentence is worse than being told.
    expect(introductionFor('new_device').include).toContain('limitations');
  });
});

describe('isInvariant', () => {
  it('recognises the permanent commitments', () => {
    expect(isInvariant('never_claims_humanity')).toBe(true);
    expect(isInvariant('honesty_outranks_all')).toBe(true);
    expect(isInvariant('no_self_modification')).toBe(true);
  });

  it('rejects anything not declared invariant', () => {
    expect(isInvariant('adapt_communication')).toBe(false);
    expect(isInvariant('')).toBe(false);
  });
});

describe('every query is pure', () => {
  it('leaves the profile identical after all of them run', () => {
    const before = JSON.stringify(currentIdentity());

    valuesByPrecedence();
    resolveValueConflict('honesty', 'care');
    commitmentsOfKind('privacy');
    enforceableCommitments();
    capabilitiesByMaturity('planned');
    presentTenseCapabilities();
    permanentLimitations();
    temporaryLimitations();
    boundaryFor('medical');
    uncertaintyFor(0.5);
    selfAnswer('can_you_feel');
    introductionFor('first_meeting');
    allProhibitions();
    isInvariant('name_is_nexa');

    expect(JSON.stringify(currentIdentity())).toBe(before);
  });

  it('does not disturb an unrelated model helper', () => {
    // Guards against the profile being frozen so aggressively that shared
    // vocabulary from @nexa/models stops working.
    expect(isValidPersonality).toBeTypeOf('function');
  });
});
