/**
 * The bus, split into the pieces a consumer can depend on separately.
 *
 * `EventPublisher` and `EventSubscriber` are the two halves; `EventBus` is
 * their intersection. A package should name the narrowest one it needs —
 * publishing and subscribing are different capabilities, and a type that grants
 * both to something that only emits is an invitation to build an event chain.
 */
export type { EventBus, HandlerErrorReporter, EventBusOptions } from './EventBus.js';
export { InProcessEventBus, RecordingEventBus } from './EventBus.js';

export type { EventPublisher } from './EventPublisher.js';
export type { EventSubscriber } from './EventSubscriber.js';

export type {
  EventHandler,
  EventFilter,
  Unsubscribe,
  HandlerPriority,
  SubscribeOptions,
  Subscription,
  HandlerContext,
  DropReason,
  EventBusLifecycle,
} from './EventHandler.js';
export { PRIORITY } from './EventHandler.js';

export type { EventMiddleware } from './EventMiddleware.js';
export { composeMiddleware, allowOnly, persistentOnly } from './EventMiddleware.js';
