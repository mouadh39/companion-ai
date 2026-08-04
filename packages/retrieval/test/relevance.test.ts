import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, retrieve } from '@nexa/retrieval';
import type { RetrievalRequest } from '@nexa/retrieval';
import {
  at,
  excludedFor,
  feeling,
  frustratedWorld,
  goalOf,
  idsOf,
  insightOf,
  memoryOf,
  heard,
  relationshipOf,
  turnOf,
  unityWorld,
} from './fixtures.js';

const ask = (overrides: Partial<RetrievalRequest> = {}) =>
  retrieve({
    at: at(0),
    ...heard(''),
    conversation: [],
    memories: [],
    insights: [],
    goals: [],
    relationship: null,
    ...overrides,
  });

describe('the Unity example from the brief', () => {
  const request = {
    ...heard("I'm working on Unity today.", { entities: ['Unity'] }),
    memories: unityWorld(),
    goals: [goalOf('ship the Nexa demo')],
  };

  it('retrieves the Unity preference, the project and the VR discussion', () => {
    const retrieved = idsOf(ask(request));

    expect(retrieved).toContain('mem-i-prefer-unity-over-unreal-for-p');
    expect(retrieved).toContain('mem-the-nexa-project-is-built-in-uni');
    expect(retrieved).toContain('mem-we-talked-about-vr-headset-comfo');
  });

  it('retrieves none of the pizza, Canada or guitar', () => {
    const retrieved = idsOf(ask(request));

    expect(retrieved).not.toContain('mem-i-like-pizza-with-extra-cheese-');
    expect(retrieved).not.toContain('mem-the-canada-trip-last-summer-was-');
    expect(retrieved).not.toContain('mem-i-need-new-guitar-strings-');
  });

  it('says why the pizza was left out', () => {
    const excluded = excludedFor(ask(request), 'mem-i-like-pizza-with-extra-cheese-');

    expect(excluded?.reason).toBe('below_relevance_floor');
    expect(excluded?.bestSignalStrength).toBeLessThan(DEFAULT_CONFIG.relevanceFloor);
  });

  it('surfaces the active goal’s own material through goal relevance', () => {
    // "Nexa demo" shares no word with "I'm working on Unity today"; the goal is
    // what connects them.
    const withGoal = ask(request);
    const withoutGoal = ask({ ...request, goals: [] });

    const project = withGoal.items.find(
      (item) => item.source === 'memory' && item.memory.subject === 'project',
    );
    expect(project?.signals.goal_relevance).toBeGreaterThan(0);
    expect(withoutGoal.degraded.some((entry) => entry.reason === 'goals_unavailable')).toBe(
      true,
    );
  });
});

describe('the frustration example from the brief', () => {
  const world = frustratedWorld();
  const request = {
    ...heard("I'm feeling frustrated.", {
      emotion: feeling('frustration'),
    }),
    memories: world.memories,
    insights: world.insights,
    relationship: relationshipOf(),
  };

  it('retrieves the recent debugging sessions', () => {
    const retrieved = idsOf(ask(request));

    expect(retrieved).toContain('mem-we-spent-the-evening-debugging-t');
    expect(retrieved).toContain('mem-another-debugging-session-on-the');
  });

  it('retrieves the overworking reflection and the communication preference', () => {
    const retrieved = idsOf(ask(request));

    expect(retrieved).toContain('ins-the-user-may-currently-be-overwo');
    expect(retrieved).toContain('ins-the-user-consistently-prefers-sh');
  });

  it('retrieves the relationship state', () => {
    expect(idsOf(ask(request))).toContain('relationship:familiar');
  });

  it('retrieves no unrelated interests', () => {
    // The reason `communication` is its own class. Folded into `preference`,
    // a difficult moment would pull in the user's taste in board games.
    const retrieved = idsOf(ask(request));

    expect(retrieved).not.toContain('ins-the-user-appears-to-enjoy-chess-');
    expect(retrieved).not.toContain('mem-i-like-pizza-with-extra-cheese-');
  });

  it('needs the emotion to be read with some confidence', () => {
    const unsure = ask({
      ...request,
      ...heard("I'm feeling frustrated.", {
        emotion: { ...feeling('frustration', 0.2), confidence: 0.2 as never },
      }),
    });

    // A guess about someone's mood should not decide what they are told.
    expect(idsOf(unsure)).not.toContain('ins-the-user-may-currently-be-overwo');
  });

  it('does not open the emotional route for an ordinary mood', () => {
    const calm = ask({
      ...request,
      ...heard('What is on for today?', { emotion: feeling('curiosity') }),
    });

    expect(idsOf(calm)).not.toContain('ins-the-user-may-currently-be-overwo');
  });
});

describe('importance is a tiebreaker, never a ticket', () => {
  it('leaves out a maximally important memory that is about nothing relevant', () => {
    const outcome = ask({
      ...heard("I'm working on Unity today.", { entities: ['Unity'] }),
      memories: [
        memoryOf('I prefer Unity over Unreal.', 'preference', 40),
        memoryOf('My daughter was born in April.', 'milestone', 500, {
          importance: 1 as never,
          confidence: 1 as never,
          reinforcementCount: 20,
        }),
      ],
    });

    expect(idsOf(outcome)).toStrictEqual(['mem-i-prefer-unity-over-unreal-']);
  });

  it('uses importance to order things that are all relevant', () => {
    const outcome = ask({
      ...heard('Tell me about the shader work.'),
      memories: [
        memoryOf('The shader work was a milestone.', 'milestone', 10, {
          importance: 0.95 as never,
        }),
        memoryOf('The shader work was a milestone.', 'milestone', 10, {
          importance: 0.2 as never,
          id: 'mem-low' as never,
        }),
      ],
    });

    // The duplicate is collapsed, and the survivor is the one that mattered.
    expect(idsOf(outcome)[0]).toBe('mem-the-shader-work-was-a-milestone-');
  });
});

describe('anchoring routes', () => {
  it('anchors on a named entity even when no word is shared', () => {
    const outcome = ask({
      ...heard('How is that going?', { entities: ['Nexa'] }),
      memories: [memoryOf('Nexa is built in Unity.', 'project', 10)],
    });

    expect(outcome.items[0]?.anchor).toBe('entity');
  });

  it('anchors on the conversation when the message says almost nothing', () => {
    // "why?" has no content words at all. The topic lives in what came before,
    // and without topic continuity this turn retrieves nothing.
    const outcome = ask({
      ...heard('Why?'),
      conversation: [
        turnOf('user', 'The shader compiler keeps failing on Android.', 0),
        turnOf('companion', 'That is usually a precision qualifier problem.', 0),
      ],
      memories: [memoryOf('The shader compiler fails on Android builds.', 'project', 5)],
    });

    expect(outcome.items[0]?.anchor).toBe('topic_continuity');
  });

  it('does not let a message match itself through the topic window', () => {
    // The message's own terms are removed from the topic set. Left in, every
    // turn would score full continuity with itself and the dimension would be a
    // constant wearing a signal's name.
    const outcome = ask({
      ...heard('Unity shaders.'),
      conversation: [turnOf('user', 'Unity shaders.', 0)],
      memories: [memoryOf('Unity shaders are fiddly.', 'project', 5)],
    });

    expect(outcome.items[0]?.signals.topic_continuity).toBe(0);
  });

  it('anchors semantically when vectors are supplied and words do not overlap', () => {
    const outcome = ask({
      ...heard('How is the game engine work going?'),
      memories: [
        memoryOf('Prototyping in Unity again.', 'project', 5, {
          embedding: {
            vectorId: 'v1',
            model: 'voyage-3',
            dimensions: 3,
            embeddedAt: at(-5),
          },
        }),
      ],
      semantic: {
        model: 'voyage-3',
        dimensions: 3,
        query: [1, 0, 0],
        vectors: new Map([['v1', [0.95, 0.3, 0]]]),
      },
    });

    expect(outcome.items[0]?.anchor).toBe('semantic');
    expect(outcome.degraded.some((entry) => entry.reason === 'semantic_unavailable')).toBe(
      false,
    );
  });
});

describe('what may not be a candidate', () => {
  it('never surfaces a retired or superseded insight', () => {
    const outcome = ask({
      ...heard('Do I still like chess?'),
      insights: [
        insightOf('The user appears to enjoy chess.', 'interest', 10, { status: 'retired' }),
        insightOf('The user may not enjoy chess.', 'interest', 1, { status: 'superseded' }),
      ],
    });

    expect(outcome.items).toHaveLength(0);
    expect(outcome.excluded.every((entry) => entry.reason === 'not_eligible')).toBe(true);
  });

  it('never surfaces an expired memory', () => {
    const outcome = ask({
      ...heard('What about the parcel?'),
      memories: [memoryOf('The parcel arrives on Tuesday.', 'temporary', 5, {
        expiresAt: at(-4),
      })],
    });

    expect(outcome.items).toHaveLength(0);
  });

  it('cannot see anything created after the moment it was asked about', () => {
    const outcome = ask({
      at: at(-10),
      ...heard('Tell me about Unity.'),
      memories: [memoryOf('Unity is my favourite engine.', 'preference', 0)],
    });

    expect(outcome.items).toHaveLength(0);
    expect(outcome.excluded[0]?.detail).toContain('replay');
  });

  it('surfaces a contested insight, because doubt is not disqualification', () => {
    const outcome = ask({
      ...heard('Do I prefer short answers?'),
      insights: [
        insightOf('The user consistently prefers short, direct answers.', 'communication', 5, {
          status: 'contested',
        }),
      ],
    });

    expect(outcome.items).toHaveLength(1);
  });
});
