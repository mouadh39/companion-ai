import type { PerceptionPort } from '@nexa/core';
import type {
  EmotionSignal,
  IntentCandidate,
  IntentKind,
  Perception,
  UserEmotion,
} from '@nexa/models';
import { confidence } from '@nexa/models';

/**
 * Rule-based perception.
 *
 * Deliberately not a model call. Perception runs on the critical path of every
 * turn, and a provider round trip here would pay the provider's latency twice
 * — once to understand the message and once to answer it.
 *
 * The rules below are shallow on purpose. They exist so the pipeline has a real
 * `Perception` to reason about while the seam stays honest; replacing them with
 * a classifier is an implementation change behind `PerceptionPort` and nothing
 * else moves.
 */

const QUESTION_MARKERS = [
  'what', 'why', 'how', 'when', 'where', 'who', 'which',
  'can you', 'could you', 'do you', 'is it', 'are you',
];

const REQUEST_MARKERS = [
  'please', 'help me', 'i need', 'can you make', 'build', 'write', 'create', 'fix', 'show me',
];

const PLANNING_MARKERS = [
  'plan', 'schedule', 'tomorrow', 'next week', 'deadline', 'goal', 'roadmap', 'milestone',
];

const CORRECTION_MARKERS = [
  "that's wrong", 'thats wrong', 'no,', 'actually,', "isn't right", 'incorrect', 'not true',
];

const CASUAL_MARKERS = ['hey', 'hi', 'hello', 'good morning', 'good night', 'thanks', 'thank you'];

const EMOTION_MARKERS: ReadonlyArray<readonly [UserEmotion, readonly string[]]> = [
  ['frustrated', ['frustrated', 'annoying', 'stuck', 'ugh', 'not working', 'broken']],
  ['stressed', ['stressed', 'overwhelmed', 'too much', 'deadline', 'panic']],
  ['sad', ['sad', 'down', 'lonely', 'miss ']],
  ['excited', ['excited', 'amazing', "can't wait", 'awesome']],
  ['happy', ['happy', 'great', 'glad', 'love it']],
  ['proud', ['proud', 'finally', 'i did it', 'it works']],
  ['tired', ['tired', 'exhausted', 'sleepy', 'long day']],
  ['confused', ['confused', "don't understand", 'unclear', 'lost']],
];

const includesAny = (haystack: string, needles: readonly string[]): boolean =>
  needles.some((needle) => haystack.includes(needle));

export class HeuristicPerception implements PerceptionPort {
  async perceive(text: string): Promise<Perception> {
    const normalised = text.trim().replace(/\s+/g, ' ');
    const lower = normalised.toLowerCase();

    const intents: IntentCandidate[] = [];

    if (lower.endsWith('?') || includesAny(lower, QUESTION_MARKERS)) {
      intents.push({ kind: 'question', confidence: confidence(lower.endsWith('?') ? 0.9 : 0.6) });
    }
    if (includesAny(lower, CORRECTION_MARKERS)) {
      intents.push({ kind: 'correction', confidence: confidence(0.75) });
    }
    if (includesAny(lower, REQUEST_MARKERS)) {
      intents.push({ kind: 'request', confidence: confidence(0.7) });
    }
    if (includesAny(lower, PLANNING_MARKERS)) {
      intents.push({ kind: 'planning', confidence: confidence(0.65) });
    }
    if (includesAny(lower, CASUAL_MARKERS) && normalised.length < 40) {
      intents.push({ kind: 'casual', confidence: confidence(0.7) });
    }

    const emotion = this.#detectEmotion(lower);
    if (emotion !== null && (emotion.emotion === 'sad' || emotion.emotion === 'stressed')) {
      intents.push({ kind: 'emotional_support', confidence: confidence(0.6) });
    }

    if (intents.length === 0 && normalised.length > 0) {
      intents.push({ kind: 'statement', confidence: confidence(0.5) });
    }

    intents.sort((a, b) => b.confidence - a.confidence);

    return {
      text: normalised,
      intents,
      emotion,
      entities: this.#extractEntities(normalised),
    };
  }

  #detectEmotion(lower: string): EmotionSignal | null {
    for (const [emotion, markers] of EMOTION_MARKERS) {
      if (includesAny(lower, markers)) {
        // Confidence is capped low on purpose. These are keyword matches, and
        // overstating certainty here would let a single word convince the
        // companion that someone is upset when they are not.
        return { emotion, intensity: confidence(0.6), confidence: confidence(0.55) };
      }
    }
    return null;
  }

  /** Capitalised words and quoted spans — a placeholder for real NER. */
  #extractEntities(text: string): readonly string[] {
    const entities = new Set<string>();

    for (const match of text.matchAll(/\b[A-Z][a-zA-Z0-9_.-]{2,}\b/g)) {
      const value = match[0];
      if (value !== undefined) entities.add(value);
    }
    for (const match of text.matchAll(/"([^"]{2,60})"/g)) {
      const value = match[1];
      if (value !== undefined) entities.add(value);
    }

    return [...entities].slice(0, 10);
  }
}

const isIntent = (value: string): value is IntentKind =>
  ['question', 'request', 'statement', 'planning', 'emotional_support', 'casual', 'correction', 'unknown'].includes(
    value,
  );

export { isIntent };
