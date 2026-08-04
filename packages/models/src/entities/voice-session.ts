import type { ConversationId, UserId, VoiceSessionId } from '@nexa/shared';
import type { AudioRoute, VoiceEndReason, VoiceSessionState } from '../enums/voice.js';
import type { ConfidenceScore } from '../value-objects/score.js';
import type { Duration, Timestamp } from '../value-objects/timestamp.js';

/**
 * One period of spoken interaction.
 *
 * Modelled as its own entity rather than as a flag on `Conversation` because
 * the two have different lifetimes: a conversation may span a voice session, a
 * typed exchange, and another voice session an hour later. Collapsing them
 * would make "how long did we actually talk?" unanswerable.
 *
 * Carries no audio. Waveforms are large, sensitive, and useless to the domain —
 * what the core reasons about is the transcript and the timing. Audio, if
 * retained at all, is the client's and the media store's concern.
 */
export interface VoiceSession {
  readonly id: VoiceSessionId;
  readonly userId: UserId;
  /** The conversation this speech belongs to. A session always has one. */
  readonly conversationId: ConversationId;
  readonly state: VoiceSessionState;
  readonly route: AudioRoute;
  readonly startedAt: Timestamp;
  /** Null while the session is open. */
  readonly endedAt: Timestamp | null;
  /** Null until the session ends. Wall-clock, not speaking time. */
  readonly duration: Duration | null;
  /** Populated exactly when `endedAt` is. */
  readonly endReason: VoiceEndReason | null;
  /**
   * How many times the user cut the companion off.
   *
   * A product metric in the domain on purpose. `39_Voice_System.md` treats
   * interruption as normal conversational behaviour rather than as an error,
   * and a rising count is the clearest available signal that the companion is
   * talking too much.
   */
  readonly interruptionCount: number;
}

/**
 * One stretch of recognised speech.
 *
 * `isFinal` distinguishes an interim hypothesis from a settled one. Interim
 * results change as the speaker continues, so acting on one — starting a turn,
 * writing a memory — means acting on words the user did not finish saying.
 */
export interface Transcript {
  readonly sessionId: VoiceSessionId;
  readonly text: string;
  readonly isFinal: boolean;
  /** Recogniser confidence. Low values should make the companion confirm, not guess. */
  readonly confidence: ConfidenceScore;
  /** Offset from session start, so segments order without depending on clock skew. */
  readonly offset: Duration;
  /** BCP 47 tag the recogniser detected, or null when it does not report one. */
  readonly detectedLocale: string | null;
}

/**
 * Silence before the companion treats an utterance as finished, in ms.
 *
 * The single most felt number in the voice system. Too short and it interrupts
 * anyone who pauses to think; too long and every exchange feels sluggish.
 */
export const END_OF_UTTERANCE_SILENCE_MS = 800;

/**
 * Silence before an idle session closes itself, in ms.
 *
 * Two minutes. A live microphone with nobody speaking is both a cost and a
 * privacy surface, and `allowVoiceCapture` is meaningless if a session that
 * nobody ended stays open indefinitely.
 */
export const SESSION_SILENCE_TIMEOUT_MS = 2 * 60 * 1000;

/** Below this recogniser confidence, the companion should confirm rather than act. */
export const MIN_ACTIONABLE_TRANSCRIPT_CONFIDENCE = 0.65;
