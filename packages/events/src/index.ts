/**
 * `@nexa/events` — the event envelope, the typed bus, and the event catalogue.
 *
 * Events are facts about what already happened. If a caller needs a return
 * value, it wants a port, not an event.
 */
export type { EventEnvelope, EventCorrelation, EventDraft } from './envelope.js';
export { defineEvent } from './envelope.js';

export type {
  TurnStage,
  TurnStartedPayload,
  TurnCompletedPayload,
  TurnFailedPayload,
  DecisionMadePayload,
  ActionGeneratedPayload,
  MemoryCandidateCreatedPayload,
  DomainEvent,
  DomainEventType,
  EventOfType,
  AnyEventDraft,
} from './catalogue.js';
export {
  turnStarted,
  turnCompleted,
  turnFailed,
  decisionMade,
  actionGenerated,
  memoryCandidateCreated,
} from './catalogue.js';

export type { EventBus, EventHandler, Unsubscribe, HandlerErrorReporter } from './bus.js';
export { InProcessEventBus, RecordingEventBus } from './bus.js';
