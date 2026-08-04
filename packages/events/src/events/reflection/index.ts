import type { ConfidenceScore, ImportanceScore, MemoryId } from '@nexa/models';
import type { EventEnvelope } from '../../interfaces/envelope.js';
import { defineEvent } from '../../interfaces/envelope.js';

/**
 * Facts about the companion turning experience into knowledge.
 *
 * Reflection runs in the worker, not the API process — `04_System_Architecture.md`
 * justifies that split on *failure domain* rather than scale: a reflection storm
 * must not degrade the latency of a live conversation. These events are how the
 * rest of the system learns that it happened, and they are the reason the split
 * costs nothing in visibility.
 *
 * `nexa.reflection.finished` is the accepted spelling of the brief's
 * `ReflectionCompleted`.
 */

export interface ReflectionStartedPayload {
  readonly reflectionId: string;
  /** The period being reflected over, ISO 8601 UTC. */
  readonly window: { readonly from: string; readonly to: string };
  readonly memoryCount: number;
}

export interface ReflectionFinishedPayload {
  readonly reflectionId: string;
  readonly insightIds: readonly MemoryId[];
  readonly window: { readonly from: string; readonly to: string };
  readonly durationMs: number;
}

/**
 * A new understanding was derived from existing memories.
 *
 * Insights are stored as `reflective` memories — knowledge the companion
 * concluded rather than observed. `confidence` starts lower than for anything
 * `user_stated` for exactly that reason, and carrying `derivedFrom` is what
 * lets the companion answer "how do you know that?" with its actual reasoning
 * instead of a plausible reconstruction.
 */
export interface InsightGeneratedPayload {
  readonly insightId: MemoryId;
  readonly derivedFrom: readonly MemoryId[];
  readonly confidence: ConfidenceScore;
  readonly importance: ImportanceScore;
  readonly summary: string;
}

export const reflectionStarted = defineEvent<
  'nexa.reflection.started',
  ReflectionStartedPayload
>('nexa.reflection.started', 1, { source: 'reflection' });

export const reflectionFinished = defineEvent<
  'nexa.reflection.finished',
  ReflectionFinishedPayload
>('nexa.reflection.finished', 1, { source: 'reflection' });

export const insightGenerated = defineEvent<
  'nexa.reflection.insight.generated',
  InsightGeneratedPayload
>('nexa.reflection.insight.generated', 1, { source: 'reflection' });

export type ReflectionEvent =
  | EventEnvelope<'nexa.reflection.started', ReflectionStartedPayload>
  | EventEnvelope<'nexa.reflection.finished', ReflectionFinishedPayload>
  | EventEnvelope<'nexa.reflection.insight.generated', InsightGeneratedPayload>;

export const REFLECTION_EVENTS = [
  reflectionStarted,
  reflectionFinished,
  insightGenerated,
] as const;
