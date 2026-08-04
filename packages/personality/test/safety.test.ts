import { describe, expect, it } from 'vitest';
import type { Perception, PersonalityProfile, Relationship, UserEmotion } from '@nexa/models';
import {
  TRAIT_NAMES,
  confidence,
  defaultPersonality,
  defaultPreferences,
  initialCounters,
  isValidExpression,
  timestamp,
} from '@nexa/models';
import { composeExpression } from '@nexa/personality';

/**
 * The rules that must hold whatever else is true.
 *
 * Each of these is a floor rather than a tendency, so they are tested against
 * the input most likely to break them — a maximally playful companion, a
 * maximally close relationship, an eager mood — rather than against defaults.
 * A rule that only holds for the default personality is not a rule.
 */

const maximal = (value: number): PersonalityProfile => ({
  traits: Object.fromEntries(TRAIT_NAMES.map((name) => [name, value])) as PersonalityProfile['traits'],
  adaptive: { energy: value, focus: value, engagement: value },
  revision: 1,
});

const perceptionOf = (
  intent: Perception['intents'][number]['kind'],
  emotion: UserEmotion | null = null,
): Perception => ({
  text: 'hello',
  intents: [{ kind: intent, confidence: confidence(0.9) }],
  emotion:
    emotion === null
      ? null
      : { emotion, intensity: confidence(1), confidence: confidence(1) },
  entities: [],
});

const closest: Relationship = {
  id: 'rel-1' as Relationship['id'],
  userId: 'user-1' as Relationship['userId'],
  companionId: 'comp-1' as Relationship['companionId'],
  type: 'trusted',
  dimensions: { trust: 1, familiarity: 1, warmth: 1, reliance: 1 },
  interactionCount: 5_000,
  firstMetAt: timestamp('2020-01-01T00:00:00.000Z'),
  lastInteractionAt: timestamp('2026-01-01T00:00:00.000Z'),
  inferredStyle: null,
  boundaries: [],
  counters: initialCounters(),
  metadata: {},
};

const DISTRESS: readonly UserEmotion[] = ['frustrated', 'stressed', 'sad'];

describe('humour is suppressed under distress, whatever else is true', () => {
  for (const emotion of DISTRESS) {
    it(`drives humour to zero when the user seems ${emotion}`, () => {
      const profile = composeExpression({
        // Every trait maxed, closest possible relationship, playful mood — the
        // configuration most likely to produce a joke.
        personality: maximal(1),
        relationship: closest,
        perception: perceptionOf('statement', emotion),
        preferences: defaultPreferences(),
      });

      expect(profile.humor).toBe(0);
    });
  }

  it('never chooses a playful tone under distress', () => {
    for (const emotion of DISTRESS) {
      const profile = composeExpression({
        personality: maximal(1),
        relationship: closest,
        perception: perceptionOf('casual', emotion),
      });

      expect(profile.tone).toBe('concerned');
    }
  });

  it('still allows humour for the same companion when the user is calm', () => {
    const profile = composeExpression({
      personality: maximal(1),
      relationship: closest,
      perception: perceptionOf('casual', 'calm'),
    });

    expect(profile.humor).toBeGreaterThan(0);
  });
});

describe('initiative is capped when proactive speech is disallowed', () => {
  it('never reaches `lead`, whatever the traits and relationship say', () => {
    const profile = composeExpression({
      personality: maximal(1),
      relationship: closest,
      perception: perceptionOf('question'),
      preferences: { ...defaultPreferences(), allowProactiveSpeech: false },
    });

    expect(profile.initiative).not.toBe('lead');
  });

  it('records why it was capped when the cap actually bit', () => {
    const profile = composeExpression({
      personality: maximal(1),
      relationship: closest,
      perception: perceptionOf('question'),
      preferences: {
        ...defaultPreferences(),
        allowProactiveSpeech: false,
        communicationStyle: 'socratic',
      },
    });

    const codes = profile.rationale.map((reason) => reason.code);
    expect(codes).toContain('proactive_speech_disallowed');
    expect(profile.initiative).toBe('offer');
  });

  it('does not record a cap that never bit', () => {
    const profile = composeExpression({
      personality: maximal(0),
      perception: perceptionOf('statement'),
      preferences: { ...defaultPreferences(), allowProactiveSpeech: false },
    });

    const codes = profile.rationale.map((reason) => reason.code);
    expect(codes).not.toContain('proactive_speech_disallowed');
  });

  it('defaults to disallowing proactive speech', () => {
    expect(defaultPreferences().allowProactiveSpeech).toBe(false);
  });
});

describe('boundaries', () => {
  it('carries every boundary through to the profile', () => {
    const profile = composeExpression({
      personality: defaultPersonality(),
      relationship: { ...closest, boundaries: ['work stress', 'my brother'] },
      perception: perceptionOf('statement'),
    });

    expect(profile.boundaries).toStrictEqual(['work stress', 'my brother']);
  });

  it('reports them in the rationale so they cannot be silently dropped', () => {
    const profile = composeExpression({
      personality: defaultPersonality(),
      relationship: { ...closest, boundaries: ['one thing'] },
      perception: perceptionOf('statement'),
    });

    expect(profile.rationale.map((reason) => reason.code)).toContain(
      'relationship_boundaries',
    );
  });

  it('does not alias the relationship array', () => {
    const boundaries = ['a'];
    const profile = composeExpression({
      personality: defaultPersonality(),
      relationship: { ...closest, boundaries },
      perception: perceptionOf('statement'),
    });

    boundaries.push('b');
    expect(profile.boundaries).toStrictEqual(['a']);
  });
});

describe('dimensions stay in range under extreme input', () => {
  const emotions: readonly UserEmotion[] = [
    'calm', 'happy', 'excited', 'curious', 'focused',
    'confused', 'frustrated', 'stressed', 'sad', 'tired', 'proud',
  ];
  const intents = [
    'question', 'request', 'statement', 'planning',
    'emotional_support', 'casual', 'correction', 'unknown',
  ] as const;
  const styles = ['direct', 'detailed', 'socratic', 'encouraging', 'concise'] as const;

  it('holds across every combination of extremes', () => {
    for (const level of [0, 1]) {
      for (const emotion of emotions) {
        for (const intent of intents) {
          for (const style of styles) {
            const profile = composeExpression({
              personality: maximal(level),
              relationship: { ...closest, inferredStyle: style },
              perception: perceptionOf(intent, emotion),
              preferences: { ...defaultPreferences(), communicationStyle: style },
            });

            expect(isValidExpression(profile)).toBe(true);
            expect(['minimal', 'brief', 'moderate', 'thorough']).toContain(profile.detail);
            expect(['follow', 'offer', 'lead']).toContain(profile.initiative);
            expect(['slow', 'measured', 'brisk']).toContain(profile.pacing);
          }
        }
      }
    }
  });

  it('reports which dimensions ended pinned at a bound', () => {
    const profile = composeExpression({
      personality: maximal(1),
      perception: perceptionOf('statement'),
    });

    const clamped = profile.rationale.find((reason) => reason.code === 'clamped');
    expect(clamped).toBeDefined();
    expect(clamped?.affects.length).toBeGreaterThan(0);
  });
});
