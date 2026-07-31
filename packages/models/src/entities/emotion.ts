import type { CompanionId, UserId } from '@nexa/shared';
import type { EmotionOrigin, EmotionSubject, EmotionType } from '../enums/emotion.js';
import type { ConfidenceScore, Valence } from '../value-objects/score.js';
import type { Timestamp } from '../value-objects/timestamp.js';

/**
 * An emotional reading, held over time.
 *
 * Distinct from `EmotionSignal` in `perception.ts`, and the split matters.
 * `EmotionSignal` is what one message suggested — a momentary observation.
 * `EmotionState` is what the companion currently *believes*, accumulated across
 * messages and decayed toward neutral. One is an input; the other is a
 * position, and a position is what downstream systems should reason against.
 *
 * `14_Emotion_Engine.md` is explicit that this influences conversation and
 * planning without controlling decisions. Nothing here carries authority.
 */
export interface EmotionState {
  readonly subject: EmotionSubject;
  /** Whose state this is. Exactly one of these is populated per `subject`. */
  readonly userId: UserId | null;
  readonly companionId: CompanionId | null;
  readonly type: EmotionType;
  /** How strongly the emotion is held. */
  readonly intensity: ConfidenceScore;
  /** The pleasant/unpleasant axis, independent of `type`. */
  readonly valence: Valence;
  /** How sure the companion is about this reading. Never assume certainty. */
  readonly confidence: ConfidenceScore;
  readonly origin: EmotionOrigin;
  /** When this reading was formed. */
  readonly at: Timestamp;
  /**
   * What prompted it, in one phrase.
   *
   * Needed for the companion to be able to say *why* it thinks someone seems
   * frustrated. An emotional read the companion cannot justify is one it should
   * not voice, and without this field it can only ever assert.
   */
  readonly cause: string | null;
}

/**
 * How an emotional state changed between two readings.
 *
 * Emitted rather than stored. `06_Event_System.md` names `EmotionChanged` as a
 * canonical event, and a transition carries information a snapshot cannot: the
 * companion should react to someone becoming frustrated, not to their being
 * frustrated, which it may already have acknowledged.
 */
export interface EmotionTransition {
  readonly from: EmotionType;
  readonly to: EmotionType;
  readonly at: Timestamp;
  /** True when the change is large enough to be worth acting on. */
  readonly significant: boolean;
}

/**
 * How quickly an emotional reading decays toward neutral, per hour.
 *
 * Decay is required, not cosmetic. Without it the companion treats a
 * frustration detected on Monday as current on Friday, and the longer a state
 * persists the more confidently wrong the companion becomes about it.
 */
export const EMOTION_DECAY_PER_HOUR = 0.25;

/**
 * Minimum confidence before an emotional read may influence a response.
 *
 * `10_Decision_Engine.md` requires weak signals to be ignored rather than acted
 * on. Below this, the reading is recorded and not used — which is how a
 * companion avoids telling a cheerful person they seem upset.
 */
export const MIN_ACTIONABLE_EMOTION_CONFIDENCE = 0.6;

/** The neutral reading. What the companion believes before it has evidence. */
export const neutralEmotion = (
  subject: EmotionSubject,
  at: Timestamp,
): Omit<EmotionState, 'userId' | 'companionId'> => ({
  subject,
  type: 'neutral',
  intensity: 0 as ConfidenceScore,
  valence: 0 as Valence,
  confidence: 1 as ConfidenceScore,
  origin: 'decayed',
  at,
  cause: null,
});
