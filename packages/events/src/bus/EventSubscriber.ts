import type { DomainEventType, EventOfType } from '../events/index.js';
import type { EventHandler, SubscribeOptions, Unsubscribe } from './EventHandler.js';

/**
 * The read half of the bus.
 *
 * The counterpart to `EventPublisher`. A capability package that reacts to
 * facts — the memory writer, the reflection scheduler — depends on this and
 * gains no ability to publish, which keeps a handler from emitting in direct
 * response to its own trigger. `06_Event_System.md` lists that cycle as an
 * anti-pattern the bus cannot detect, so the type system declines to make it
 * convenient.
 */
export interface EventSubscriber {
  /**
   * Registers a handler for one event type.
   *
   * The payload narrows from the type string alone, so a handler never casts.
   * If a cast is needed, the catalogue union is wrong.
   *
   * Returns a function that removes the subscription. Composition roots keep it
   * to shut down cleanly.
   */
  subscribe<TType extends DomainEventType>(
    type: TType,
    handler: EventHandler<EventOfType<TType>>,
    options?: SubscribeOptions<EventOfType<TType>>,
  ): Unsubscribe;

  /**
   * Registers a handler that removes itself after one delivery.
   *
   * Scoped to *this process*, and that scoping is the whole caveat. Delivery is
   * at-least-once, so "once" here means "once per subscription in this
   * process", never "once per event in the system" — a redelivery after the
   * handler has detached is simply not seen. Safe for tests and one-shot wiring
   * (waiting for `session.started` before opening a socket); wrong for anything
   * whose correctness depends on having observed the event. For that, use
   * `subscribe` with `oncePerEvent`, which keys on `event.id`.
   *
   * When a `filter` is supplied, only a delivery that passes it counts.
   */
  once<TType extends DomainEventType>(
    type: TType,
    handler: EventHandler<EventOfType<TType>>,
    options?: SubscribeOptions<EventOfType<TType>>,
  ): Unsubscribe;

  /**
   * Removes a previously registered handler by reference.
   *
   * The function returned by `subscribe` is the ergonomic path. This exists for
   * callers that hold the handler but not the closure — a registry tearing down
   * a named set of listeners, for instance.
   *
   * Returns true when a subscription was found and removed.
   */
  unsubscribe<TType extends DomainEventType>(
    type: TType,
    handler: EventHandler<EventOfType<TType>>,
  ): boolean;
}
