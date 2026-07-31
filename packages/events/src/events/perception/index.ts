import type { ConfidenceScore, VoiceSessionId, WorldObjectType } from '@nexa/models';
import type { EventEnvelope } from '../../interfaces/envelope.js';
import { defineEvent } from '../../interfaces/envelope.js';

/**
 * What the client's sensors reported.
 *
 * **Every event here is `ephemeral` — delivered, never written to the log.**
 * That classification is the reason `durability` exists on the envelope. A
 * headset emitting object detections at 30–60 Hz produces millions of rows per
 * user per day, on the same append-only table reflection and analytics must
 * scan, carrying almost nothing worth keeping once the frame is gone.
 *
 * The rule that follows: **a consumer needing perception history is using the
 * wrong event.** Durable knowledge about the environment comes from the world
 * model (`nexa.world.*`), which is written deliberately and at human pace after
 * these signals have been aggregated.
 *
 * Clients are additionally expected to sample before emitting. Ephemerality
 * bounds storage; it does not bound dispatch cost.
 */

export interface VoiceDetectedPayload {
  readonly sessionId: VoiceSessionId;
  /** True on speech onset, false on end of utterance. */
  readonly speaking: boolean;
  readonly confidence: ConfidenceScore;
}

export interface ObjectDetectedPayload {
  readonly objectType: WorldObjectType;
  readonly label: string;
  readonly confidence: ConfidenceScore;
  /** Client-local tracking handle. Not a `WorldObjectId` — nothing is persisted. */
  readonly trackingId: string;
}

/**
 * A face entered view.
 *
 * Deliberately carries **no biometric data, no identity, and no image** — a
 * count and a confidence only. Face data in an append-only log that
 * `06_Event_System.md` forbids editing would collide directly with erasure and
 * biometric-data obligations, so the safe design is for the sensitive part
 * never to enter the system rather than to be deleted from it later.
 *
 * Recognising *who* someone is, if it is ever built, is a separate capability
 * with its own consent model. It is not this event with a field added.
 */
export interface FaceDetectedPayload {
  readonly count: number;
  readonly confidence: ConfidenceScore;
  /** Whether a face is oriented toward the companion. Drives gaze, nothing else. */
  readonly attending: boolean;
}

export interface ImageCapturedPayload {
  /** Where the frame was put. The bus never carries image bytes. */
  readonly reference: string;
  readonly width: number;
  readonly height: number;
  /** True when the user explicitly asked for the capture. */
  readonly userInitiated: boolean;
}

export interface EnvironmentUpdatedPayload {
  readonly lightingChanged: boolean;
  readonly surfaceCount: number;
  /** Tracking quality, 0–1. Low values should make the companion less certain. */
  readonly trackingQuality: ConfidenceScore;
}

/** A voice session finished. Persistent — this one is a durable fact, not a frame. */
export interface VoiceFinishedPayload {
  readonly sessionId: VoiceSessionId;
  readonly durationMs: number;
  readonly interruptionCount: number;
}

export const voiceDetected = defineEvent<'nexa.perception.voice.detected', VoiceDetectedPayload>(
  'nexa.perception.voice.detected',
  1,
  { source: 'voice', durability: 'ephemeral' },
);

export const objectDetected = defineEvent<
  'nexa.perception.object.detected',
  ObjectDetectedPayload
>('nexa.perception.object.detected', 1, { source: 'vision', durability: 'ephemeral' });

export const faceDetected = defineEvent<'nexa.perception.face.detected', FaceDetectedPayload>(
  'nexa.perception.face.detected',
  1,
  { source: 'vision', durability: 'ephemeral' },
);

export const imageCaptured = defineEvent<'nexa.perception.image.captured', ImageCapturedPayload>(
  'nexa.perception.image.captured',
  1,
  { source: 'vision', durability: 'ephemeral' },
);

export const environmentUpdated = defineEvent<
  'nexa.perception.environment.updated',
  EnvironmentUpdatedPayload
>('nexa.perception.environment.updated', 1, { source: 'vision', durability: 'ephemeral' });

export const voiceFinished = defineEvent<'nexa.voice.finished', VoiceFinishedPayload>(
  'nexa.voice.finished',
  1,
  { source: 'voice' },
);

export type PerceptionEvent =
  | EventEnvelope<'nexa.perception.voice.detected', VoiceDetectedPayload>
  | EventEnvelope<'nexa.perception.object.detected', ObjectDetectedPayload>
  | EventEnvelope<'nexa.perception.face.detected', FaceDetectedPayload>
  | EventEnvelope<'nexa.perception.image.captured', ImageCapturedPayload>
  | EventEnvelope<'nexa.perception.environment.updated', EnvironmentUpdatedPayload>
  | EventEnvelope<'nexa.voice.finished', VoiceFinishedPayload>;

export const PERCEPTION_EVENTS = [
  voiceDetected,
  objectDetected,
  faceDetected,
  imageCaptured,
  environmentUpdated,
  voiceFinished,
] as const;
