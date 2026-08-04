/**
 * `@nexa/events` — the envelope, the typed bus, and the event catalogue.
 *
 * Events are **facts about what already happened**. If a caller needs a return
 * value, it wants a port, not an event — `06_Event_System.md` gives the test,
 * and it is the rule that keeps this package from becoming a distributed call
 * stack with no stack trace.
 *
 * The turn itself is a synchronous pipeline that *emits* events; it is not
 * built out of them. Everything downstream of the turn is a projection over
 * what this package delivers.
 *
 * Layout:
 *
 * - `interfaces/` — the envelope and `defineEvent`
 * - `bus/`        — publisher, subscriber, handlers, middleware, implementations
 * - `events/`     — the catalogue, one directory per domain
 * - `registry/`   — runtime lookup of event definitions
 * - `errors/`     — typed failures for reporting and dead-lettering
 * - `utils/`      — handler decorators and filter builders
 *
 * Consumers import from `@nexa/events`, never from a subpath.
 */

export type {
  EventEnvelope,
  EventCorrelation,
  EventDraft,
  EventSource,
  EventDurability,
  EventDefinitionOptions,
  EventFactory,
} from './interfaces/index.js';
export { defineEvent, EVENT_SOURCES } from './interfaces/index.js';

export type {
  EventBus,
  EventPublisher,
  EventSubscriber,
  EventHandler,
  EventFilter,
  EventMiddleware,
  Unsubscribe,
  HandlerErrorReporter,
  HandlerPriority,
  SubscribeOptions,
  Subscription,
  HandlerContext,
  DropReason,
  EventBusLifecycle,
  EventBusOptions,
} from './bus/index.js';
export {
  InProcessEventBus,
  RecordingEventBus,
  composeMiddleware,
  allowOnly,
  persistentOnly,
  PRIORITY,
} from './bus/index.js';

// The one wildcard in this barrel, and it is deliberate: the catalogue is ~14
// domain modules of payload types and factories, and enumerating them here
// would mean every new event needs two edits, with the second one easy to skip
// — an event that exists but cannot be imported. `DomainEvent`,
// `DomainEventType`, `EventOfType` and `AnyEventDraft` come through here too.
export * from './events/index.js';

export type { EventDefinition } from './registry/index.js';
export { EventRegistry, createEventRegistry, ALL_EVENT_TYPES } from './registry/index.js';

export {
  HandlerFailedError,
  HandlerTimeoutError,
  UnknownEventTypeError,
  DuplicateEventTypeError,
  DeadLetteredError,
} from './errors/index.js';

export {
  oncePerEvent,
  named,
  forCompanion,
  forUser,
  forTurn,
  persistentOnlyFilter,
  every,
  some,
  not,
} from './utils/index.js';
