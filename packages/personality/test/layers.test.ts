import { describe, expect, it } from 'vitest';
import type {
  ExpressionProfile,
  Perception,
  PersonalityProfile,
  Relationship,
  TraitName,
  UserEmotion,
} from '@nexa/models';
import {
  confidence,
  defaultPersonality,
  defaultPreferences,
  initialCounters,
  initialRelationshipDimensions,
  timestamp,
} from '@nexa/models';
import { composeExpression } from '@nexa/personality';

const withTraits = (overrides: Partial<Record<TraitName, number>>): PersonalityProfile => {
  const base = defaultPersonality();
  return { ...base, traits: { ...base.traits, ...overrides } };
};

const perceptionOf = (
  intent: Perception['intents'][number]['kind'],
  emotion: UserEmotion | null = null,
  emotionConfidence = 0.9,
): Perception => ({
  text: 'hello',
  intents: [{ kind: intent, confidence: confidence(0.9) }],
  emotion:
    emotion === null
      ? null
      : {
          emotion,
          intensity: confidence(0.8),
          confidence: confidence(emotionConfidence),
        },
  entities: [],
});

const relationshipWith = (overrides: Partial<Relationship> = {}): Relationship => ({
  id: 'rel-1' as Relationship['id'],
  userId: 'user-1' as Relationship['userId'],
  companionId: 'comp-1' as Relationship['companionId'],
  type: 'new',
  dimensions: initialRelationshipDimensions(),
  interactionCount: 0,
  firstMetAt: timestamp('2026-01-01T00:00:00.000Z'),
  lastInteractionAt: timestamp('2026-01-01T00:00:00.000Z'),
  inferredStyle: null,
  boundaries: [],
  counters: initialCounters(),
  metadata: {},
  ...overrides,
});

const compose = (
  personality: PersonalityProfile,
  perception: Perception = perceptionOf('statement'),
  extra: { relationship?: Relationship | null; preferences?: ReturnType<typeof defaultPreferences> | null } = {},
): ExpressionProfile =>
  composeExpression({ personality, perception, ...extra });

describe('layer 1 — base traits', () => {
  it('maps traits of the same name straight through', () => {
    const profile = compose(withTraits({ warmth: 0.2, curiosity: 0.3, formality: 0.9 }));

    expect(profile.warmth).toBeCloseTo(0.2, 5);
    expect(profile.curiosity).toBeCloseTo(0.3, 5);
    expect(profile.formality).toBeCloseTo(0.9, 5);
  });

  it('derives emotional expression from empathy', () => {
    const high = compose(withTraits({ empathy: 0.95 }));
    const low = compose(withTraits({ empathy: 0.1 }));

    expect(high.emotionalExpression).toBeGreaterThan(low.emotionalExpression);
  });

  it('trades elaboration against directness', () => {
    const elaborate = compose(withTraits({ patience: 1, creativity: 1, directness: 0 }));
    const blunt = compose(withTraits({ patience: 0.2, creativity: 0.2, directness: 1 }));

    expect(elaborate.detail).toBe('thorough');
    expect(blunt.detail).toBe('brief');
  });

  it('requires both curiosity and confidence before it will offer', () => {
    const both = compose(withTraits({ curiosity: 0.9, confidence: 0.9 }));
    const curiousOnly = compose(withTraits({ curiosity: 0.9, confidence: 0.1 }));
    const confidentOnly = compose(withTraits({ curiosity: 0.1, confidence: 0.9 }));

    expect(both.initiative).toBe('offer');
    expect(curiousOnly.initiative).toBe('follow');
    expect(confidentOnly.initiative).toBe('follow');
  });

  it('never reaches `lead` from traits alone', () => {
    const maximal = compose(
      withTraits({ curiosity: 1, confidence: 1, directness: 1, playfulness: 1 }),
    );

    expect(maximal.initiative).not.toBe('lead');
  });

  it('paces from adaptive energy', () => {
    const base = defaultPersonality();
    const tired = compose({ ...base, adaptive: { ...base.adaptive, energy: 0.1 } });
    const lively = compose({ ...base, adaptive: { ...base.adaptive, energy: 0.9 } });

    expect(tired.pacing).toBe('slow');
    expect(lively.pacing).toBe('brisk');
  });

  it('reduces detail when focus is low', () => {
    const base = defaultPersonality();
    const focused = compose({ ...base, adaptive: { ...base.adaptive, focus: 0.9 } });
    const scattered = compose({ ...base, adaptive: { ...base.adaptive, focus: 0.1 } });

    expect(scattered.detail).not.toBe(focused.detail);
  });
});

describe('layer 2 — relationship', () => {
  it('changes nothing when there is no relationship record', () => {
    const withNull = compose(defaultPersonality(), perceptionOf('statement'), {
      relationship: null,
    });
    const omitted = compose(defaultPersonality(), perceptionOf('statement'));

    expect(withNull).toStrictEqual(omitted);
  });

  it('relaxes formality as familiarity grows', () => {
    const stranger = compose(defaultPersonality(), perceptionOf('statement'), {
      relationship: relationshipWith(),
    });
    const familiar = compose(defaultPersonality(), perceptionOf('statement'), {
      relationship: relationshipWith({
        dimensions: { trust: 0.5, familiarity: 1, warmth: 0.5, reliance: 0 },
      }),
    });

    expect(familiar.formality).toBeLessThan(stranger.formality);
    expect(familiar.directness).toBeGreaterThan(stranger.directness);
  });

  it('permits humour only once the stage reaches familiar', () => {
    const dimensions = { trust: 0.8, familiarity: 0.5, warmth: 0.5, reliance: 0 };

    const acquainted = compose(defaultPersonality(), perceptionOf('statement'), {
      relationship: relationshipWith({ type: 'acquainted', dimensions }),
    });
    const familiar = compose(defaultPersonality(), perceptionOf('statement'), {
      relationship: relationshipWith({ type: 'familiar', dimensions }),
    });

    expect(familiar.humor).toBeGreaterThan(acquainted.humor);
  });

  it('holds back on every presuming axis when trust is low', () => {
    const dimensions = { trust: 0.1, familiarity: 0.5, warmth: 0.5, reliance: 0 };
    const trusting = { trust: 0.9, familiarity: 0.5, warmth: 0.5, reliance: 0 };

    const guarded = compose(defaultPersonality(), perceptionOf('statement'), {
      relationship: relationshipWith({ dimensions }),
    });
    const open = compose(defaultPersonality(), perceptionOf('statement'), {
      relationship: relationshipWith({ dimensions: trusting }),
    });

    expect(guarded.humor).toBeLessThan(open.humor);
    expect(guarded.directness).toBeLessThan(open.directness);
    expect(guarded.emotionalExpression).toBeLessThan(open.emotionalExpression);
  });

  it('raises initiative when the user relies on the companion', () => {
    const independent = compose(withTraits({ curiosity: 0.1, confidence: 0.1 }), perceptionOf('statement'), {
      relationship: relationshipWith({
        dimensions: { trust: 0.6, familiarity: 0.5, warmth: 0.5, reliance: 0 },
      }),
    });
    const reliant = compose(withTraits({ curiosity: 0.1, confidence: 0.1 }), perceptionOf('statement'), {
      relationship: relationshipWith({
        dimensions: { trust: 0.6, familiarity: 0.5, warmth: 0.5, reliance: 0.9 },
      }),
    });

    expect(independent.initiative).toBe('follow');
    expect(reliant.initiative).toBe('offer');
  });
});

describe('layer 3 — conversation context', () => {
  it('does not act on an emotional read below the confidence floor', () => {
    const weak = compose(defaultPersonality(), perceptionOf('statement', 'sad', 0.3));
    const none = compose(defaultPersonality(), perceptionOf('statement', null));

    expect(weak).toStrictEqual(none);
  });

  it('acts on the same read once it is confident enough', () => {
    const strong = compose(defaultPersonality(), perceptionOf('statement', 'sad', 0.95));
    const none = compose(defaultPersonality(), perceptionOf('statement', null));

    expect(strong).not.toStrictEqual(none);
    expect(strong.warmth).toBeGreaterThan(none.warmth);
  });

  it('suppresses curiosity when support is sought rather than raising it', () => {
    const support = compose(defaultPersonality(), perceptionOf('emotional_support'));
    const question = compose(defaultPersonality(), perceptionOf('question'));

    expect(support.curiosity).toBeLessThan(question.curiosity);
    expect(support.warmth).toBeGreaterThan(question.warmth);
  });

  it('becomes plainer and shorter after a correction', () => {
    const correction = compose(defaultPersonality(), perceptionOf('correction'));
    const statement = compose(defaultPersonality(), perceptionOf('statement'));

    expect(correction.directness).toBeGreaterThan(statement.directness);
    expect(correction.humor).toBeLessThan(statement.humor);
  });

  it('explains more when the user seems confused', () => {
    const confused = compose(defaultPersonality(), perceptionOf('question', 'confused'));
    const calm = compose(defaultPersonality(), perceptionOf('question', 'calm'));

    expect(confused.pacing).toBe('slow');
    expect(confused.directness).toBeGreaterThan(calm.directness);
  });

  it('matches an excited user with more energy and pace', () => {
    const excited = compose(defaultPersonality(), perceptionOf('casual', 'excited'));
    const calm = compose(defaultPersonality(), perceptionOf('casual', 'calm'));

    expect(excited.energy).toBeGreaterThan(calm.energy);
  });

  it('scales the adjustment by the intensity of the reading', () => {
    const mild: Perception = {
      text: 'hello',
      intents: [{ kind: 'statement', confidence: confidence(0.9) }],
      emotion: { emotion: 'happy', intensity: confidence(0.1), confidence: confidence(0.9) },
      entities: [],
    };
    const intense: Perception = {
      ...mild,
      emotion: { emotion: 'happy', intensity: confidence(1), confidence: confidence(0.9) },
    };

    expect(compose(defaultPersonality(), intense).warmth).toBeGreaterThan(
      compose(defaultPersonality(), mild).warmth,
    );
  });

  it('relaxes slightly once a conversation is well under way', () => {
    const turns = Array.from({ length: 8 }, (_, index) => ({
      role: index % 2 === 0 ? ('user' as const) : ('companion' as const),
      content: 'x',
      at: timestamp('2026-01-01T00:00:00.000Z'),
    }));

    const deep = composeExpression({
      personality: defaultPersonality(),
      perception: perceptionOf('statement'),
      recentTurns: turns,
    });
    const fresh = composeExpression({
      personality: defaultPersonality(),
      perception: perceptionOf('statement'),
    });

    expect(deep.formality).toBeLessThan(fresh.formality);
  });
});

describe('layer 4 — stated preferences', () => {
  it('applies each communication style distinctly', () => {
    const styles = ['direct', 'detailed', 'socratic', 'encouraging', 'concise'] as const;

    const profiles = styles.map((style) =>
      compose(defaultPersonality(), perceptionOf('statement'), {
        preferences: { ...defaultPreferences(), communicationStyle: style },
      }),
    );

    const detailed = profiles[styles.indexOf('detailed')];
    const concise = profiles[styles.indexOf('concise')];
    const socratic = profiles[styles.indexOf('socratic')];
    const encouraging = profiles[styles.indexOf('encouraging')];

    expect(detailed?.detail).toBe('thorough');
    expect(concise?.detail).toBe('minimal');
    expect(socratic?.curiosity).toBeGreaterThan(0.8);
    expect(encouraging?.warmth).toBeGreaterThan(0.9);
  });

  it('changes nothing when preferences are absent', () => {
    const withNull = compose(defaultPersonality(), perceptionOf('statement'), {
      preferences: null,
    });
    const omitted = compose(defaultPersonality(), perceptionOf('statement'));

    expect(withNull).toStrictEqual(omitted);
  });
});
