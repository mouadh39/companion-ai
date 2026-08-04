import type {
  ConfidenceScore,
  EmotionOrigin,
  EmotionSubject,
  EmotionType,
  Valence,
} from '@nexa/models';
import type { EventEnvelope } from '../../interfaces/envelope.js';
import { defineEvent } from '../../interfaces/envelope.js';

/**
 * Facts about emotional state.
 *
 * Transitions rather than snapshots. The companion should react to someone
 * *becoming* frustrated, not to their *being* frustrated — which it may have
 * acknowledged five minutes ago. Carrying `previous` and `current` together is
 * what makes that distinction available to a handler without it keeping state.
 *
 * Nothing here carries authority. `14_Emotion_Engine.md` is explicit that
 * emotion informs conversation and planning and never controls a decision, and
 * `confidence` travels on every reading so a weak signal can be declined.
 */

/** One reading, as carried inside a transition. */
export interface EmotionSnapshot {
  readonly type: EmotionType;
  readonly intensity: ConfidenceScore;
  readonly valence: Valence;
}

export interface EmotionChangedPayload {
  readonly subject: EmotionSubject;
  readonly previous: EmotionSnapshot;
  readonly current: EmotionSnapshot;
  readonly confidence: ConfidenceScore;
  readonly origin: EmotionOrigin;
  /** What prompted the change, in one phrase. Null when nothing identifiable. */
  readonly trigger: string | null;
}

/**
 * A sustained shift in emotional baseline.
 *
 * Distinct from `emotion.changed`, which fires on individual readings. Mood is
 * the trend across a window — the thing worth mentioning ("you've seemed tired
 * this week") as opposed to the thing worth reacting to right now.
 *
 * There is no `Mood` entity in `@nexa/models`; this is expressed as an
 * `EmotionType` over an explicit window rather than by adding a concept the
 * domain does not yet have. If mood acquires behaviour beyond this, it should
 * become a first-class entity before this payload grows.
 */
export interface MoodChangedPayload {
  readonly previous: EmotionType;
  readonly current: EmotionType;
  /** The window the trend was computed over, ISO 8601 UTC. */
  readonly window: { readonly from: string; readonly to: string };
  /** How many readings supported it. A mood from two samples is noise. */
  readonly sampleCount: number;
}

/**
 * Sustained stress, above the threshold worth acting on.
 *
 * Its own event rather than an `emotion.changed` variant because the response
 * differs in kind: stress is the one reading that should make the companion
 * consider saying *less*, and a handler for that should not have to filter the
 * general emotion stream to find it.
 */
export interface StressDetectedPayload {
  readonly intensity: ConfidenceScore;
  readonly confidence: ConfidenceScore;
  readonly durationMs: number;
  readonly indicators: readonly string[];
}

export const emotionChanged = defineEvent<'nexa.emotion.changed', EmotionChangedPayload>(
  'nexa.emotion.changed',
  1,
  { source: 'emotion' },
);

export const moodChanged = defineEvent<'nexa.emotion.mood.changed', MoodChangedPayload>(
  'nexa.emotion.mood.changed',
  1,
  { source: 'emotion' },
);

export const stressDetected = defineEvent<'nexa.emotion.stress.detected', StressDetectedPayload>(
  'nexa.emotion.stress.detected',
  1,
  { source: 'emotion' },
);

export type EmotionEvent =
  | EventEnvelope<'nexa.emotion.changed', EmotionChangedPayload>
  | EventEnvelope<'nexa.emotion.mood.changed', MoodChangedPayload>
  | EventEnvelope<'nexa.emotion.stress.detected', StressDetectedPayload>;

export const EMOTION_EVENTS = [emotionChanged, moodChanged, stressDetected] as const;
