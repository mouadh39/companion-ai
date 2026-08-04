import { describe, expect, it } from 'vitest';
import { decide } from '@nexa/memory';
import { at, memoryOf, prefs, proposalOf } from './fixtures.js';

const form = (
  proposal: ReturnType<typeof proposalOf>,
  existing: Parameters<typeof decide>[0]['existing'] = [],
  preferences: Parameters<typeof decide>[0]['preferences'] = null,
) => decide({ proposal, existing, at: at(0), preferences });

describe('permission outranks everything', () => {
  it('rejects when the user has memory formation switched off', () => {
    const decision = form(
      proposalOf('my name is Sam', { statedExplicitly: true }),
      [],
      { ...prefs(), allowMemoryFormation: false },
    );

    expect(decision.outcome).toBe('reject');
    if (decision.outcome !== 'reject') return;
    expect(decision.reason).toBe('formation_disabled');
  });

  it('rejects even an explicit request to remember', () => {
    // The one gate that is not a judgement. A user who switched this off has
    // said the thing that outranks anything the engine could conclude.
    const decision = form(
      proposalOf('please remember my name is Sam', {
        statedExplicitly: true,
        salience: 1,
      }),
      [],
      { ...prefs(), allowMemoryFormation: false },
    );

    expect(decision.outcome).toBe('reject');
  });

  it('forms when preferences are unknown but permit it', () => {
    expect(form(proposalOf('my name is Sam'), [], prefs()).outcome).toBe('store');
  });
});

describe('a memory must earn its place', () => {
  it('rejects empty content', () => {
    const decision = form(proposalOf('   '));

    expect(decision.outcome).toBe('reject');
    if (decision.outcome !== 'reject') return;
    expect(decision.reason).toBe('empty_content');
  });

  it('rejects a low-confidence inference about identity', () => {
    // `identity` demands the highest confidence, and a reflection is the
    // weakest source. A companion should not conclude who someone is.
    const decision = form(
      proposalOf('i am a nurse', { source: 'reflection' }),
    );

    expect(decision.outcome).toBe('reject');
    if (decision.outcome !== 'reject') return;
    expect(decision.reason).toBe('below_confidence_floor');
  });

  it('accepts the same claim when the user states it', () => {
    const decision = form(proposalOf('i am a nurse', { source: 'user_stated' }));

    expect(decision.outcome).toBe('store');
    if (decision.outcome !== 'store') return;
    expect(decision.draft.subject).toBe('identity');
  });

  it('explains a rejection rather than failing silently', () => {
    const decision = form(proposalOf('i am a nurse', { source: 'reflection' }));

    expect(decision.reasons.length).toBeGreaterThan(1);
    expect(decision.reasons.map((r) => r.code)).toContain('subject_classified');
    expect(decision.reasons.map((r) => r.code)).toContain('below_threshold');
  });
});

describe('an explicit request is answered, not weighed', () => {
  it('raises importance sharply', () => {
    const casual = form(proposalOf('the meeting is at three'));
    const asked = form(
      proposalOf('the meeting is at three', { statedExplicitly: true }),
    );

    expect(asked.outcome).toBe('store');
    if (asked.outcome !== 'store' || casual.outcome !== 'store') return;
    expect(asked.draft.importance).toBeGreaterThan(casual.draft.importance);
  });

  it('records that it was asked for', () => {
    const decision = form(proposalOf('remember the gate code', { statedExplicitly: true }));

    expect(decision.reasons.map((r) => r.code)).toContain('explicitly_requested');
  });
});

describe('duplicates reinforce rather than accumulate', () => {
  const existing = memoryOf('i prefer short answers', 'preference');

  it('reinforces a restatement instead of storing a second copy', () => {
    const decision = form(proposalOf('i prefer shorter answers'), [existing]);

    expect(decision.outcome).toBe('reinforce');
    if (decision.outcome !== 'reinforce') return;
    expect(decision.targetId).toBe(existing.id);
  });

  it('raises confidence only slightly', () => {
    const decision = form(proposalOf('i prefer shorter answers'), [existing]);

    if (decision.outcome !== 'reinforce') throw new Error('expected reinforce');
    // Saying a thing twice is evidence; saying it twenty times must not
    // manufacture certainty the source cannot support.
    expect(decision.reinforcement.confidenceDelta).toBeLessThanOrEqual(0.05);
    expect(decision.reinforcement.importanceDelta).toBeLessThanOrEqual(0.03);
  });

  it('extends expiry when reinforcement reaches past the current one', () => {
    const decision = decide({
      proposal: proposalOf('i prefer shorter answers'),
      existing: [existing],
      at: at(600),
      preferences: null,
    });

    if (decision.outcome !== 'reinforce') throw new Error('expected reinforce');
    expect(Date.parse(decision.reinforcement.expiresAt ?? '')).toBeGreaterThan(
      Date.parse(existing.expiresAt ?? ''),
    );
  });

  it('never pulls an expiry closer', () => {
    // Reinforcing a young memory with a long TTL must not shorten its life.
    // Being mentioned again is evidence it matters, not evidence against.
    const decision = decide({
      proposal: proposalOf('i prefer shorter answers'),
      existing: [existing],
      at: at(1),
      preferences: null,
    });

    if (decision.outcome !== 'reinforce') throw new Error('expected reinforce');
    expect(Date.parse(decision.reinforcement.expiresAt ?? '')).toBeGreaterThanOrEqual(
      Date.parse(existing.expiresAt ?? ''),
    );
  });

  it('never reinforces across subjects', () => {
    // Same words, different part of a life. Comparing across subjects is how
    // "I work in a hospital" comes to supersede "my sister works in a hospital".
    const sibling = memoryOf('my sister works in a hospital', 'relationship');
    const decision = form(proposalOf('i work in a hospital'), [sibling]);

    expect(decision.outcome).not.toBe('reinforce');
  });
});

describe('better sourcing supersedes', () => {
  it('replaces an inference when the user states it plainly', () => {
    const inferred = memoryOf('i prefer short answers', 'preference', {
      confidence: 0.5 as never,
      source: 'reflection',
    });

    const decision = form(
      proposalOf('i prefer short answers', { source: 'user_stated' }),
      [inferred],
    );

    expect(decision.outcome).toBe('supersede');
    if (decision.outcome !== 'supersede') return;
    expect(decision.targetId).toBe(inferred.id);
  });

  it('does not supersede when the new source is no better', () => {
    const stated = memoryOf('i prefer short answers', 'preference', {
      confidence: 0.9 as never,
    });

    expect(form(proposalOf('i prefer short answers'), [stated]).outcome).toBe(
      'reinforce',
    );
  });
});

describe('conflict detection', () => {
  it('supersedes a contradicted preference', () => {
    const old = memoryOf('i like early mornings', 'preference');
    const decision = form(proposalOf('i do not like early mornings'), [old]);

    expect(decision.outcome).toBe('supersede');
    if (decision.outcome !== 'supersede') return;
    expect(decision.reasons.map((r) => r.code)).toContain('conflict_detected');
  });

  it('keeps both when the subject cannot be superseded', () => {
    // A thing that happened does not stop having happened. Superseding a
    // milestone would rewrite history rather than update a belief.
    const event = memoryOf('i graduated in june', 'milestone');
    // Phrased to overlap lexically — the matcher is not semantic, and a
    // paraphrase it cannot see is a limit documented rather than pretended away.
    const decision = form(
      proposalOf('i never graduated in june', { subject: 'milestone' }),
      [event],
    );

    expect(decision.outcome).toBe('store');
    expect(decision.reasons.map((r) => r.code)).toContain('conflict_detected');
  });
});

describe('retention', () => {
  it('gives permanent subjects no expiry', () => {
    const decision = form(proposalOf('my name is Sam'));

    expect(decision.outcome).toBe('store');
    if (decision.outcome !== 'store') return;
    expect(decision.draft.subject).toBe('identity');
    expect(decision.draft.expiresAt).toBeNull();
  });

  it('expires temporary memories quickly', () => {
    const decision = form(proposalOf('the parcel arrives tomorrow'));

    expect(decision.outcome).toBe('store');
    if (decision.outcome !== 'store') return;
    expect(decision.draft.subject).toBe('temporary');
    expect(decision.draft.expiresAt).not.toBeNull();
  });

  it('honours a user retention limit shorter than the policy', () => {
    const decision = form(proposalOf('i prefer short answers'), [], {
      ...prefs(),
      memoryRetentionDays: 30,
    });

    if (decision.outcome !== 'store') throw new Error('expected store');
    const days =
      (Date.parse(decision.draft.expiresAt ?? '') - Date.parse(at(0))) / 86_400_000;
    expect(Math.round(days)).toBe(30);
  });

  it('applies a user retention limit even to subjects that never expire', () => {
    // Memory is the user's property. A retention setting that identity facts
    // could ignore would be a setting that does not mean what it says.
    const decision = form(proposalOf('my name is Sam'), [], {
      ...prefs(),
      memoryRetentionDays: 90,
    });

    if (decision.outcome !== 'store') throw new Error('expected store');
    expect(decision.draft.expiresAt).not.toBeNull();
  });
});

describe('purity', () => {
  it('returns a deeply equal decision for the same request', () => {
    const request = {
      proposal: proposalOf('i prefer tea'),
      existing: [memoryOf('i prefer coffee', 'preference')],
      at: at(0),
      preferences: prefs(),
    };

    expect(decide(request)).toStrictEqual(decide(request));
  });

  it('does not mutate its inputs', () => {
    const proposal = proposalOf('my name is Sam', { tags: ['identity'] });
    const existing = [memoryOf('i prefer tea', 'preference')];
    const snapshot = structuredClone({ proposal, existing });

    decide({ proposal, existing, at: at(0), preferences: prefs() });

    expect({ proposal, existing }).toStrictEqual(snapshot);
  });

  it('reads no clock — the same proposal at two moments differs only in dates', () => {
    const early = form(proposalOf('the parcel arrives tomorrow'));
    const later = decide({
      proposal: proposalOf('the parcel arrives tomorrow'),
      existing: [],
      at: at(10),
      preferences: null,
    });

    if (early.outcome !== 'store' || later.outcome !== 'store') return;
    expect(early.draft.createdAt).not.toBe(later.draft.createdAt);
    expect(early.draft.importance).toBe(later.draft.importance);
  });

  it('never throws, whatever the proposal looks like', () => {
    const nasty = ['', '   ', '🙂', 'a'.repeat(10_000), 'not not not'];

    for (const content of nasty) {
      expect(() => form(proposalOf(content))).not.toThrow();
    }
  });
});
