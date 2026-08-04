import { describe, expect, it } from 'vitest';
import type { Perception, Relationship, UserEmotion } from '@nexa/models';
import {
  confidence,
  defaultPersonality,
  defaultPreferences,
  initialCounters,
  initialRelationshipDimensions,
  isValidExpression,
  timestamp,
} from '@nexa/models';
import { composeExpression } from '@nexa/personality';
import type { ExpressionRequest } from '@nexa/personality';

/**
 * The engine is pure, so every test here is a plain function call with no
 * clock, no stub and no fixture teardown. That is the return on keeping I/O in
 * `PersonalityPort` and out of this package.
 */

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

const relationshipWith = (
  overrides: Partial<Relationship> & Partial<{ dimensions: Relationship['dimensions'] }> = {},
): Relationship => ({
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

const baseRequest = (overrides: Partial<ExpressionRequest> = {}): ExpressionRequest => ({
  personality: defaultPersonality(),
  perception: perceptionOf('question'),
  ...overrides,
});

describe('composeExpression', () => {
  it('produces a profile whose continuous dimensions are all within 0–1', () => {
    const profile = composeExpression(baseRequest());
    expect(isValidExpression(profile)).toBe(true);
  });

  it('is pure — the same request yields a deeply equal profile', () => {
    const request = baseRequest({
      relationship: relationshipWith({ type: 'close' }),
      preferences: defaultPreferences(),
    });

    expect(composeExpression(request)).toStrictEqual(composeExpression(request));
  });

  it('does not mutate its inputs', () => {
    const personality = defaultPersonality();
    const snapshot = structuredClone(personality);

    composeExpression(baseRequest({ personality }));

    expect(personality).toStrictEqual(snapshot);
  });

  it('runs with only the required inputs — relationship and preferences are optional', () => {
    const profile = composeExpression({
      personality: defaultPersonality(),
      perception: perceptionOf('statement'),
    });

    expect(profile.tone).toBeDefined();
    expect(profile.boundaries).toStrictEqual([]);
  });

  it('records a rationale entry for every layer that acted', () => {
    const profile = composeExpression(
      baseRequest({
        relationship: relationshipWith({
          type: 'close',
          dimensions: { trust: 0.8, familiarity: 0.8, warmth: 0.8, reliance: 0.2 },
        }),
        preferences: { ...defaultPreferences(), communicationStyle: 'concise' },
      }),
    );

    const codes = profile.rationale.map((reason) => reason.code);
    expect(codes).toContain('base_traits');
    expect(codes).toContain('relationship_familiarity');
    expect(codes).toContain('intent_shape');
    expect(codes).toContain('stated_preference');
  });

  it('names the dimensions each reason moved', () => {
    const profile = composeExpression(
      baseRequest({ perception: perceptionOf('emotional_support') }),
    );

    const support = profile.rationale.find(
      (reason) => reason.code === 'intent_shape' && reason.affects.includes('warmth'),
    );

    expect(support).toBeDefined();
    expect(support?.affects).toContain('humor');
  });
});

describe('layer precedence', () => {
  it('lets a stated preference outrank an inferred style that disagrees', () => {
    const request = baseRequest({
      relationship: relationshipWith({ inferredStyle: 'detailed' }),
      preferences: { ...defaultPreferences(), communicationStyle: 'concise' },
    });

    const profile = composeExpression(request);

    // Inferred `detailed` raises detail by one step; stated `concise` lowers it
    // by two and is applied afterwards, so the stated value must win.
    expect(profile.detail).toBe('minimal');
  });

  it('applies an inferred style when no stated preference contradicts it', () => {
    const withInferred = composeExpression(
      baseRequest({ relationship: relationshipWith({ inferredStyle: 'detailed' }) }),
    );
    const without = composeExpression(baseRequest({ relationship: relationshipWith() }));

    expect(withInferred.detail).not.toBe(without.detail);
  });

  it('resolves familiar-but-guarded as guarded', () => {
    const profile = composeExpression(
      baseRequest({
        relationship: relationshipWith({
          type: 'familiar',
          dimensions: { trust: 0.2, familiarity: 0.9, warmth: 0.5, reliance: 0 },
        }),
      }),
    );

    const codes = profile.rationale.map((reason) => reason.code);
    expect(codes).toContain('relationship_guarded');

    // Familiarity raised humour, low trust pulled it back further.
    const familiar = composeExpression(
      baseRequest({
        relationship: relationshipWith({
          type: 'familiar',
          dimensions: { trust: 0.8, familiarity: 0.9, warmth: 0.5, reliance: 0 },
        }),
      }),
    );

    expect(profile.humor).toBeLessThan(familiar.humor);
  });
});
