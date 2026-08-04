import { describe, expect, it } from 'vitest';
import { MEMORY_SUBJECTS } from '@nexa/models';
import {
  DUPLICATE_THRESHOLD,
  RELATED_THRESHOLD,
  SUBJECT_POLICIES,
  classify,
  forgetCheck,
  forgetPass,
  negates,
  policyFor,
  similarity,
  tokenize,
} from '@nexa/memory';
import { at, memoryOf, proposalOf } from './fixtures.js';

describe('classification', () => {
  it.each([
    ['my name is Sam', 'identity'],
    ['i work as a nurse', 'identity'],
    ['i prefer short answers', 'preference'],
    ['i want to learn Spanish', 'goal'],
    ['i am working on a garden shed', 'project'],
    ['i got married last june', 'milestone'],
    ['my sister lives in Berlin', 'relationship'],
    ['the parcel arrives on tuesday', 'temporary'],
  ])('reads %s as %s', (content, subject) => {
    expect(classify(proposalOf(content))).toBe(subject);
  });

  it('lets the caller override the text entirely', () => {
    // The caller may know things the text does not say — that it came from a
    // settings screen, or from the goal engine.
    expect(classify(proposalOf('anything at all', { subject: 'identity' }))).toBe(
      'identity',
    );
  });

  it('accepts an explicit tag when the phrasing does not match', () => {
    expect(classify(proposalOf('vegetarian', { tags: ['preference'] }))).toBe(
      'preference',
    );
  });

  it('ranks milestone above relationship when both match', () => {
    // A wedding is an event that happened. Losing it after two years would be
    // worse than losing the fact that a sister exists.
    expect(classify(proposalOf('my sister got married in may'))).toBe('milestone');
  });

  it('falls back to temporary rather than guessing something permanent', () => {
    // The cheap wrong answer. A misclassified temporary memory expires in a
    // day; a misclassified identity memory is asserted about the user forever.
    expect(classify(proposalOf('the sky looks grey'))).toBe('temporary');
    expect(classify(proposalOf(''))).toBe('temporary');
  });

  it('is deterministic', () => {
    const proposal = proposalOf('i prefer tea');
    expect(classify(proposal)).toBe(classify(proposal));
  });
});

describe('similarity', () => {
  it('scores a restatement as a duplicate', () => {
    expect(similarity('i prefer short answers', 'i prefer shorter answers')).toBeGreaterThanOrEqual(
      DUPLICATE_THRESHOLD,
    );
  });

  it('scores unrelated text near zero', () => {
    expect(similarity('i prefer tea', 'the shed needs a new roof')).toBeLessThan(
      RELATED_THRESHOLD,
    );
  });

  it('is symmetric', () => {
    const a = 'i want to learn spanish this year';
    const b = 'i want to learn french this year';

    expect(similarity(a, b)).toBe(similarity(b, a));
  });

  it('ignores word order', () => {
    expect(similarity('i prefer black coffee', 'coffee black i prefer')).toBe(1);
  });

  it('handles empty and symbol-only input without throwing', () => {
    expect(similarity('', 'anything')).toBe(0);
    expect(similarity('!!!', '???')).toBe(0);
  });

  it('keeps negation words out of the stop list', () => {
    // An aggressive stop list would strip "not", turning a contradiction into
    // a duplicate — exactly the case conflict detection exists to catch.
    expect(tokenize('i do not like coffee')).toContain('not');
    expect(negates('i do not like coffee')).toBe(true);
    expect(negates('i like coffee')).toBe(false);
  });

  it('normalises suffixes consistently in both directions', () => {
    expect(tokenize('answers')).toStrictEqual(tokenize('answer'));
    expect(tokenize('shorter')).toStrictEqual(tokenize('short'));
  });
});

describe('forgetting', () => {
  it('never forgets a permanent subject to decay', () => {
    // Permanence that quietly erodes is not permanence.
    const milestone = memoryOf('i graduated in june', 'milestone');
    expect(forgetCheck(milestone, at(10_000))).toBeNull();
  });

  it('expires a temporary memory on schedule', () => {
    const note = memoryOf('the parcel arrives tomorrow', 'temporary');
    const decision = forgetCheck(note, at(5));

    expect(decision?.reason).toBe('expired');
  });

  it('keeps a temporary memory before its expiry', () => {
    const note = memoryOf('the parcel arrives tomorrow', 'temporary');
    expect(forgetCheck(note, at(0.5))).toBeNull();
  });

  it('measures decay from the last reinforcement, not from creation', () => {
    // Measured from creation, a memory recalled every week would decay on the
    // same schedule as one never mentioned again — the counter would be
    // decorative.
    const neglected = memoryOf('i prefer tea', 'preference', {
      expiresAt: at(10_000),
      importance: 0.25 as never,
    });
    const refreshed = memoryOf('i prefer tea', 'preference', {
      expiresAt: at(10_000),
      importance: 0.25 as never,
      lastReinforcedAt: at(690),
    });

    expect(forgetCheck(neglected, at(700))?.reason).toBe('decayed');
    expect(forgetCheck(refreshed, at(700))).toBeNull();
  });

  it('returns decisions in order, so a replayed pass matches', () => {
    const memories = [
      memoryOf('a', 'temporary'),
      memoryOf('b', 'milestone'),
      memoryOf('c', 'temporary'),
    ];

    const first = forgetPass(memories, at(5));
    expect(first).toStrictEqual(forgetPass(memories, at(5)));
    expect(first.map((d) => d.memoryId)).toStrictEqual(['mem-a', 'mem-c']);
  });

  it('never deletes — it only reports a reason', () => {
    const memories = [memoryOf('a', 'temporary')];
    const snapshot = structuredClone(memories);

    forgetPass(memories, at(5));

    expect(memories).toStrictEqual(snapshot);
  });

  it('is total over a malformed timestamp', () => {
    const broken = memoryOf('a', 'preference', {
      createdAt: 'not-a-date' as never,
      lastReinforcedAt: null,
    });

    expect(() => forgetCheck(broken, at(1))).not.toThrow();
  });
});

describe('subject policies are coherent', () => {
  it('covers every declared subject', () => {
    expect(Object.keys(SUBJECT_POLICIES).sort()).toStrictEqual([...MEMORY_SUBJECTS].sort());
  });

  it('keeps each policy self-consistent', () => {
    for (const subject of MEMORY_SUBJECTS) {
      const policy = policyFor(subject);

      expect(policy.subject).toBe(subject);
      // A base below the floor would make the subject unreachable without an
      // explicit request — a policy that rejects everything it describes.
      expect(policy.baseImportance).toBeGreaterThanOrEqual(policy.importanceFloor);
      expect(policy.confidenceFloor).toBeGreaterThan(0);
      expect(policy.confidenceFloor).toBeLessThanOrEqual(1);
    }
  });

  it('makes permanent subjects non-decaying and unextendable', () => {
    for (const subject of MEMORY_SUBJECTS) {
      const policy = policyFor(subject);
      if (policy.ttlDays === null) {
        // Nothing to extend, and extending would imply it could otherwise end.
        expect(policy.reinforcementExtensionDays).toBe(0);
      }
    }
  });

  it('demands the most of identity and the least of temporary', () => {
    expect(policyFor('identity').confidenceFloor).toBeGreaterThan(
      policyFor('temporary').confidenceFloor,
    );
    expect(policyFor('identity').importanceFloor).toBeGreaterThan(
      policyFor('temporary').importanceFloor,
    );
  });

  it('refuses to supersede a milestone', () => {
    expect(policyFor('milestone').supersedable).toBe(false);
  });
});
