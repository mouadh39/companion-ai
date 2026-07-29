import { type Clock, newEventId } from '@nexa/shared';
import type { AnyEventDraft, DomainEvent, DomainEventType, EventOfType } from './catalogue.js';

export type EventHandler<E> = (event: E) => Promise<void>;
export type Unsubscribe = () => void;

/**
 * The event bus.
 *
 * Nothing outside this package knows what the transport is. That is the entire
 * point of the interface: Milestone 1 ships in-process with zero
 * infrastructure, and moving to Redis later is a composition-root change with
 * no handler edits.
 */
export interface EventBus {
  /** Resolves once the event is accepted for delivery — never once handlers finish. */
  publish(draft: AnyEventDraft): Promise<void>;
  /** All accepted or none. */
  publishAll(drafts: readonly AnyEventDraft[]): Promise<void>;
  subscribe<T extends DomainEventType>(
    type: T,
    handler: EventHandler<EventOfType<T>>,
  ): Unsubscribe;
}

/** Reports a handler failure. Failures never propagate to the publisher. */
export type HandlerErrorReporter = (
  error: unknown,
  context: { readonly eventId: string; readonly eventType: string },
) => void;

/**
 * In-process transport.
 *
 * Deliberately not a toy: it enforces the same async boundary and the same
 * isolation rules as the Redis implementation will, so a handler that works
 * here works there. Specifically — publishing does not await handlers, a
 * throwing handler cannot fail the publisher, and one handler failing does not
 * prevent the others from running.
 *
 * What it does *not* provide is durability or cross-process delivery. Both
 * arrive with the transport swap, and neither changes this interface.
 */
export class InProcessEventBus implements EventBus {
  readonly #handlers = new Map<string, Set<EventHandler<never>>>();
  readonly #clock: Clock;
  readonly #onHandlerError: HandlerErrorReporter;

  constructor(clock: Clock, onHandlerError: HandlerErrorReporter) {
    this.#clock = clock;
    this.#onHandlerError = onHandlerError;
  }

  async publish(draft: AnyEventDraft): Promise<void> {
    await this.publishAll([draft]);
  }

  async publishAll(drafts: readonly AnyEventDraft[]): Promise<void> {
    // Stamped here rather than by callers so identity and time are consistent
    // across every emitter, and so a hand-written timestamp is impossible.
    const events = drafts.map(
      (draft) =>
        ({
          ...draft,
          id: newEventId(),
          occurredAt: this.#clock.nowIso(),
        }) as DomainEvent,
    );

    for (const event of events) {
      const handlers = this.#handlers.get(event.type);
      if (handlers === undefined || handlers.size === 0) continue;

      for (const handler of handlers) {
        // Not awaited: publishers must never block on handlers, and a slow
        // handler must not extend the turn a user is waiting on.
        void (handler as EventHandler<DomainEvent>)(event).catch((error: unknown) => {
          this.#onHandlerError(error, { eventId: event.id, eventType: event.type });
        });
      }
    }
  }

  subscribe<T extends DomainEventType>(
    type: T,
    handler: EventHandler<EventOfType<T>>,
  ): Unsubscribe {
    let handlers = this.#handlers.get(type);
    if (handlers === undefined) {
      handlers = new Set();
      this.#handlers.set(type, handlers);
    }

    const erased = handler as EventHandler<never>;
    handlers.add(erased);

    return () => {
      this.#handlers.get(type)?.delete(erased);
    };
  }

  /** Test and shutdown affordance. Removes every subscription. */
  clear(): void {
    this.#handlers.clear();
  }
}

/**
 * A bus that records instead of dispatching.
 *
 * Lets a test assert on what a turn emitted without wiring handlers, which is
 * the common case: most tests care that `nexa.decision.made` was published with
 * the right confidence, not that some listener reacted.
 */
export class RecordingEventBus implements EventBus {
  readonly #recorded: AnyEventDraft[] = [];

  get recorded(): readonly AnyEventDraft[] {
    return this.#recorded;
  }

  async publish(draft: AnyEventDraft): Promise<void> {
    this.#recorded.push(draft);
  }

  async publishAll(drafts: readonly AnyEventDraft[]): Promise<void> {
    this.#recorded.push(...drafts);
  }

  subscribe(): Unsubscribe {
    return () => {};
  }

  typesEmitted(): readonly string[] {
    return this.#recorded.map((event) => event.type);
  }

  clear(): void {
    this.#recorded.length = 0;
  }
}
