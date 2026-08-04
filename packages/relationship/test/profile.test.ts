import { describe, expect, it } from 'vitest';
import { PERSONALIZATION_RANK, RELATIONSHIP_RANK, timestamp } from '@nexa/models';
import { deriveProfile, replay, stageFor } from '@nexa/relationship';
import { dayOffset, mixed, relationshipAt, spread } from './fixtures.js';

const at = (days: number) => timestamp(dayOffset(days));

describe('deriveProfile answers "who are we right now?"', () => {
  it('reports the opening state on a first meeting', () => {
    const profile = deriveProfile(relationshipAt(), at(0));

    expect(profile.stage).toBe('new');
    expect(profile.cadence).toBe('first');
    expect(profile.personalization).toBe('none');
    expect(profile.initiative).toBe('follow');
    expect(profile.nextStage).toBe('acquainted');
  });

  it('recomputes the stage rather than trusting the stored one', () => {
    // A record whose stored stage disagrees with its own numbers — a hand edit,
    // or a restore from a backup taken mid-migration.
    const inflated = relationshipAt({ type: 'trusted' });

    expect(deriveProfile(inflated, at(1)).stage).toBe('new');
  });

  it('carries the dimensions through so a caller can reason past the stage', () => {
    const history = replay(relationshipAt(), spread(30, 20, { intent: 'planning' }));
    const profile = deriveProfile(history, at(20));

    expect(profile.dimensions).toStrictEqual(history.dimensions);
  });
});

describe('progression is inspectable', () => {
  it('names every unmet requirement, not just the first', () => {
    const profile = deriveProfile(relationshipAt(), at(0));

    const kinds = profile.blockers.map((blocker) => blocker.kind);
    expect(kinds).toContain('insufficient_interactions');
    expect(kinds).toContain('insufficient_elapsed_time');
  });

  it('carries the numbers so "how much further?" is arithmetic', () => {
    const profile = deriveProfile(relationshipAt(), at(0));
    const interactions = profile.blockers.find(
      (blocker) => blocker.kind === 'insufficient_interactions',
    );

    expect(interactions?.have).toBe(0);
    expect(interactions?.need).toBe(5);
  });

  it('reports blockers for the next stage, not the one already reached', () => {
    const ready = replay(relationshipAt(), spread(6, 3));
    const profile = deriveProfile(ready, at(3));

    expect(profile.stage).toBe('acquainted');
    expect(profile.nextStage).toBe('familiar');

    // The count it is short of is `familiar`'s 25, not `acquainted`'s 5.
    const interactions = profile.blockers.find(
      (blocker) => blocker.kind === 'insufficient_interactions',
    );
    expect(interactions?.need).toBe(25);
  });

  it('reports progress as the binding constraint, not an average', () => {
    // Interaction count far exceeded, elapsed days barely started. Averaging
    // would report substantial progress toward a stage that no amount of
    // talking today can reach.
    const lopsided = replay(relationshipAt(), spread(200, 1));
    const profile = deriveProfile(lopsided, at(1));

    // 200/5 interactions is 40x the requirement; 1/2 days is half. The minimum
    // governs, so progress is 0.5 — an average would report far more, toward a
    // stage no amount of talking today can reach.
    expect(profile.progress).toBe(0.5);
  });

  it('reports full progress at the final stage', () => {
    const veteran = replay(relationshipAt(), mixed(220, 200));
    const profile = deriveProfile(veteran, at(200));

    if (profile.nextStage === null) {
      expect(profile.progress).toBe(1);
      expect(profile.blockers).toStrictEqual([]);
    }
  });
});

describe('cadence is separate from familiarity', () => {
  it('reads frequent for daily contact', () => {
    const daily = replay(relationshipAt(), spread(30, 30));
    expect(deriveProfile(daily, at(30)).cadence).toBe('frequent');
  });

  it('reads sporadic for occasional contact', () => {
    const rare = replay(relationshipAt(), spread(10, 200));
    expect(deriveProfile(rare, at(200)).cadence).toBe('sporadic');
  });

  it('reads lapsed for someone who was frequent and then stopped', () => {
    const wasDaily = replay(relationshipAt(), spread(60, 60));
    const profile = deriveProfile(wasDaily, at(300));

    // The distinction that matters: still deeply familiar, but not currently
    // in contact. Reporting the historical rate would describe a relationship
    // that is no longer happening.
    expect(profile.cadence).toBe('lapsed');
    expect(profile.dimensions.familiarity).toBeGreaterThan(0.5);
  });
});

describe('behavioural consequences', () => {
  it('raises personalization only with the stage', () => {
    const stages = [
      [relationshipAt(), 0],
      [replay(relationshipAt(), spread(6, 3)), 3],
      [replay(relationshipAt(), spread(40, 30)), 30],
    ] as const;

    const ranks = stages.map(
      ([relationship, day]) =>
        PERSONALIZATION_RANK[deriveProfile(relationship, at(day)).personalization],
    );

    // Monotonic — personalisation never jumps ahead of the relationship.
    expect(ranks[0]).toBeLessThan(ranks[1] ?? 0);
    expect(ranks[1]).toBeLessThan(ranks[2] ?? 0);
  });

  it('never reaches `lead` however long the relationship runs', () => {
    const veteran = replay(
      relationshipAt(),
      spread(300, 300, { intent: 'planning', exchangeTurns: 8 }),
    );
    const profile = deriveProfile(veteran, at(300));

    // A relationship is not permission to start conversations. That is
    // `allowProactiveSpeech`, and closeness must not route around it.
    expect(profile.initiative).not.toBe('lead');
    expect(RELATIONSHIP_RANK[profile.stage]).toBeGreaterThanOrEqual(
      RELATIONSHIP_RANK.close,
    );
  });

  it('drops initiative back to follow after a lapse', () => {
    const established = replay(relationshipAt(), spread(60, 60, { intent: 'planning' }));

    expect(deriveProfile(established, at(60)).initiative).toBe('offer');
    expect(deriveProfile(established, at(400)).initiative).toBe('follow');
  });

  it('keeps shared understanding conservative early', () => {
    expect(deriveProfile(relationshipAt(), at(0)).sharedUnderstanding).toBeLessThan(0.1);
  });

  it('raises shared understanding with familiarity and collaboration', () => {
    const collaborative = replay(relationshipAt(), spread(60, 60, { intent: 'planning' }));
    const chatty = replay(relationshipAt(), spread(60, 60, { intent: 'statement' }));

    expect(
      deriveProfile(collaborative, at(60)).sharedUnderstanding,
    ).toBeGreaterThan(deriveProfile(chatty, at(60)).sharedUnderstanding);
  });
});

describe('what it passes through untouched', () => {
  it('carries boundaries verbatim', () => {
    const bounded = relationshipAt({ boundaries: ['work stress', 'my brother'] });

    expect(deriveProfile(bounded, at(1)).boundaries).toStrictEqual([
      'work stress',
      'my brother',
    ]);
  });

  it('marks an inferred style as a belief, not a stated preference', () => {
    const inferred = relationshipAt({ inferredStyle: 'concise' });
    const profile = deriveProfile(inferred, at(1));

    expect(profile.inferredStyle).toBe('concise');
    const reason = profile.rationale.find((r) => r.code === 'style_inferred');
    expect(reason?.detail).toContain('stated preference outranks');
  });

  it('reports collaboration as counts, never content', () => {
    const history = replay(relationshipAt(), spread(10, 10, { intent: 'request' }));
    const profile = deriveProfile(history, at(10));

    expect(profile.collaboration.requestsHandled).toBe(10);
    expect(profile.collaboration.plansSupported).toBe(0);
  });
});

describe('stage requirements are self-consistent', () => {
  it('makes every stage reachable by some realistic history', () => {
    const veteran = replay(relationshipAt(), mixed(220, 200));
    // A guard against a threshold table that quietly makes a stage impossible.
    expect(stageFor(veteran, at(200))).toBe('trusted');
  });
});
