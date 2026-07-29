/**
 * What the companion understood from the incoming message, before it has
 * decided anything.
 *
 * Perception is deliberately cheap and local. It runs on the critical path of
 * every turn, so a model call here would pay the provider latency twice.
 */

export type IntentKind =
  | 'question'
  | 'request'
  | 'statement'
  | 'planning'
  | 'emotional_support'
  | 'casual'
  | 'correction'
  | 'unknown';

export interface IntentCandidate {
  readonly kind: IntentKind;
  /** 0–1. Multiple intents may be present in one message. */
  readonly confidence: number;
}

export type UserEmotion =
  | 'calm'
  | 'happy'
  | 'excited'
  | 'curious'
  | 'focused'
  | 'confused'
  | 'frustrated'
  | 'stressed'
  | 'sad'
  | 'tired'
  | 'proud';

/**
 * An *estimate* of the user's emotional state, never a claim about it.
 *
 * `confidence` is carried everywhere precisely so downstream systems can decline
 * to act on a weak signal. Treating a low-confidence guess as fact is how an
 * assistant ends up telling a perfectly cheerful person that they seem upset.
 */
export interface EmotionSignal {
  readonly emotion: UserEmotion;
  readonly intensity: number;
  readonly confidence: number;
}

export interface Perception {
  /** The message as received, normalised for whitespace only. */
  readonly text: string;
  /** Ranked, highest confidence first. May be empty. */
  readonly intents: readonly IntentCandidate[];
  /** Null when no signal was detectable — which is the common case for short messages. */
  readonly emotion: EmotionSignal | null;
  /** Entities the message referred to. Feeds memory retrieval. */
  readonly entities: readonly string[];
}

/** The highest-confidence intent, or `unknown` when nothing was detected. */
export const primaryIntent = (perception: Perception): IntentKind =>
  perception.intents[0]?.kind ?? 'unknown';
