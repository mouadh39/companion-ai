import type { DecisionKind, MemoryType, ReasonCode } from '@nexa/models';
import { defineEvent, type EventDraft, type EventEnvelope } from './envelope.js';

/**
 * The events Milestone 1 emits.
 *
 * Every one is a statement of fact about something that already happened, named
 * in the past tense. If an emitter ever needs the return value of a handler,
 * that is a port, not an event — see `docs/architecture/06_Event_System.md`.
 */

export type TurnStage =
  | 'ingress'
  | 'perception'
  | 'context_assembly'
  | 'deliberation'
  | 'generation'
  | 'validation'
  | 'commit';

export interface TurnStartedPayload {
  readonly source: 'user' | 'autonomous';
  readonly intent: string | null;
}

export interface TurnCompletedPayload {
  readonly actionCount: number;
  readonly durationMs: number;
  /** True when any context section was dropped or a port timed out. */
  readonly degraded: boolean;
}

export interface TurnFailedPayload {
  readonly stage: TurnStage;
  readonly reason: string;
}

export interface DecisionMadePayload {
  readonly decisionId: string;
  readonly kind: DecisionKind;
  readonly confidence: number;
  readonly reasonCodes: readonly ReasonCode[];
  readonly alternatives: readonly DecisionKind[];
}

export interface ActionGeneratedPayload {
  readonly actionId: string;
  readonly actionType: string;
  readonly decisionId: string;
}

export interface MemoryCandidateCreatedPayload {
  readonly candidateId: string;
  readonly memoryType: MemoryType;
  readonly summary: string;
}

export const turnStarted = defineEvent<'nexa.turn.started', TurnStartedPayload>(
  'nexa.turn.started',
  1,
);
export const turnCompleted = defineEvent<'nexa.turn.completed', TurnCompletedPayload>(
  'nexa.turn.completed',
  1,
);
export const turnFailed = defineEvent<'nexa.turn.failed', TurnFailedPayload>(
  'nexa.turn.failed',
  1,
);
export const decisionMade = defineEvent<'nexa.decision.made', DecisionMadePayload>(
  'nexa.decision.made',
  1,
);
export const actionGenerated = defineEvent<
  'nexa.action.generated',
  ActionGeneratedPayload
>('nexa.action.generated', 1);
export const memoryCandidateCreated = defineEvent<
  'nexa.memory.candidate.created',
  MemoryCandidateCreatedPayload
>('nexa.memory.candidate.created', 1);

/**
 * The discriminated union of everything on the bus.
 *
 * `subscribe` narrows the payload from the type string alone, so a handler
 * never casts. If a cast is needed, this union is wrong.
 */
export type DomainEvent =
  | EventEnvelope<'nexa.turn.started', TurnStartedPayload>
  | EventEnvelope<'nexa.turn.completed', TurnCompletedPayload>
  | EventEnvelope<'nexa.turn.failed', TurnFailedPayload>
  | EventEnvelope<'nexa.decision.made', DecisionMadePayload>
  | EventEnvelope<'nexa.action.generated', ActionGeneratedPayload>
  | EventEnvelope<'nexa.memory.candidate.created', MemoryCandidateCreatedPayload>;

export type DomainEventType = DomainEvent['type'];

/** Narrows the union to the single member matching `T`. */
export type EventOfType<T extends DomainEventType> = Extract<DomainEvent, { type: T }>;

export type AnyEventDraft = EventDraft<DomainEventType, unknown>;
