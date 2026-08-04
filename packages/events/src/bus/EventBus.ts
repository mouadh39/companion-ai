import { type Clock, newEventId } from '@nexa/shared';
import type { AnyEventDraft, DomainEvent, DomainEventType, EventOfType } from '../events/index.js';
import type { EventDraft } from '../interfaces/envelope.js';
import type {
  EventBusLifecycle,
  EventFilter,
  EventHandler,
  HandlerPriority,
  SubscribeOptions,
  Subscription,
  Unsubscribe,
} from './EventHandler.js';
import type { EventPublisher } from './EventPublisher.js';
import type { EventSubscriber } from './EventSubscriber.js';
import { composeMiddleware, type EventMiddleware } from './EventMiddleware.js';

/**
 * The event bus.
 *
 * Nothing outside this package knows what the transport is. That is the entire
 * point of the interface: Milestone 1 ships in-process with zero
 * infrastructure, and moving to Redis later is a composition-root change with
 * no handler edits.
 *
 * Composed from the two halves rather than declared flat, so a consumer can
 * depend on exactly the capability it uses.
 */
export interface EventBus extends EventPublisher, EventSubscriber {}

/** Reports a handler failure. Failures never propagate to the publisher. */
export type HandlerErrorReporter = (
  error: unknown,
  context: { readonly eventId: string; readonly eventType: string },
) => void;

/** Construction-time configuration for the in-process bus. */
export interface EventBusOptions {
  /** Runs around every dispatch, outermost first. */
  readonly middleware?: readonly EventMiddleware[];
  /** Observability seams. Every hook is optional and must not throw. */
  readonly lifecycle?: EventBusLifecycle;
  /**
   * Per-handler time budget in milliseconds, or null to disable.
   *
   * `06_Event_System.md` requires slow handlers to be isolated so one cannot
   * stall the stream. The timeout does not cancel the handler — JavaScript
   * cannot — it stops *waiting* on it, so the failure is reported and the
   * stream keeps moving while the straggler finishes into the void.
   */
  readonly handlerTimeoutMs?: number | null;
}

interface StoredSubscription {
  readonly name: string;
  readonly priority: HandlerPriority;
  readonly handler: EventHandler<never>;
  readonly filter: EventFilter<never> | null;
  readonly once: boolean;
}

const DEFAULT_HANDLER_TIMEOUT_MS = 5_000;

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
  readonly #subscriptions = new Map<string, StoredSubscription[]>();
  readonly #clock: Clock;
  readonly #onHandlerError: HandlerErrorReporter;
  readonly #middleware: EventMiddleware;
  readonly #lifecycle: EventBusLifecycle;
  readonly #handlerTimeoutMs: number | null;

  constructor(
    clock: Clock,
    onHandlerError: HandlerErrorReporter,
    options: EventBusOptions = {},
  ) {
    this.#clock = clock;
    this.#onHandlerError = onHandlerError;
    this.#middleware = composeMiddleware(options.middleware ?? []);
    this.#lifecycle = options.lifecycle ?? {};
    this.#handlerTimeoutMs =
      options.handlerTimeoutMs === undefined
        ? DEFAULT_HANDLER_TIMEOUT_MS
        : options.handlerTimeoutMs;
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
      this.#safely(() => this.#lifecycle.onPublished?.(event));

      // Middleware is awaited because a veto must be decided before fan-out;
      // the handlers it guards are still dispatched without being awaited.
      await this.#middleware(event, async () => {
        this.#dispatch(event);
      }).catch((error: unknown) => {
        this.#onHandlerError(error, { eventId: event.id, eventType: event.type });
      });
    }
  }

  #dispatch(event: DomainEvent): void {
    const subscriptions = this.#subscriptions.get(event.type);
    if (subscriptions === undefined || subscriptions.length === 0) {
      this.#safely(() => this.#lifecycle.onDropped?.(event, 'no_subscribers'));
      return;
    }

    // Copied before iterating: a `once` handler removes itself during dispatch,
    // and mutating the array being walked would skip the next subscriber.
    for (const subscription of [...subscriptions]) {
      const filter = subscription.filter as EventFilter<DomainEvent> | null;
      if (filter !== null && !filter(event)) {
        this.#safely(() => this.#lifecycle.onDropped?.(event, 'filtered'));
        continue;
      }

      if (subscription.once) {
        this.#remove(event.type, subscription.handler);
      }

      this.#invoke(event, subscription);
    }
  }

  #invoke(event: DomainEvent, subscription: StoredSubscription): void {
    const startedAt = Date.now();
    const handler = subscription.handler as EventHandler<DomainEvent>;

    const context = {
      eventId: event.id,
      eventType: event.type,
      handlerName: subscription.name,
    };

    // Not awaited: publishers must never block on handlers, and a slow handler
    // must not extend the turn a user is waiting on.
    void this.#withTimeout(handler(event), event.type)
      .then(() => {
        this.#safely(() =>
          this.#lifecycle.onHandlerSucceeded?.(event, {
            ...context,
            durationMs: Date.now() - startedAt,
          }),
        );
      })
      .catch((error: unknown) => {
        this.#onHandlerError(error, context);
        this.#safely(() =>
          this.#lifecycle.onHandlerFailed?.(
            event,
            { ...context, durationMs: Date.now() - startedAt },
            error,
          ),
        );
      });
  }

  async #withTimeout(work: Promise<void>, eventType: string): Promise<void> {
    const budget = this.#handlerTimeoutMs;
    if (budget === null) {
      await work;
      return;
    }

    // The rejection races the handler rather than cancelling it. The timer is
    // cleared either way so a pending timeout cannot hold the process open.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expiry = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        reject(new HandlerTimeout(eventType, budget));
      }, budget);
    });

    try {
      await Promise.race([work, expiry]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  /** Hooks are observability, never control flow. One that throws is ignored. */
  #safely(hook: () => void): void {
    try {
      hook();
    } catch {
      // Intentionally swallowed: a broken metric must not break a dispatch.
    }
  }

  subscribe<TType extends DomainEventType>(
    type: TType,
    handler: EventHandler<EventOfType<TType>>,
    options: SubscribeOptions<EventOfType<TType>> = {},
  ): Unsubscribe {
    return this.#register(type, handler, options, false);
  }

  once<TType extends DomainEventType>(
    type: TType,
    handler: EventHandler<EventOfType<TType>>,
    options: SubscribeOptions<EventOfType<TType>> = {},
  ): Unsubscribe {
    return this.#register(type, handler, options, true);
  }

  unsubscribe<TType extends DomainEventType>(
    type: TType,
    handler: EventHandler<EventOfType<TType>>,
  ): boolean {
    return this.#remove(type, handler);
  }

  #register<TType extends DomainEventType>(
    type: TType,
    handler: EventHandler<EventOfType<TType>>,
    options: SubscribeOptions<EventOfType<TType>>,
    once: boolean,
  ): Unsubscribe {
    const erased = handler as EventHandler<never>;
    const stored: StoredSubscription = {
      name: options.name ?? handler.name ?? 'anonymous',
      priority: options.priority ?? 0,
      handler: erased,
      filter: options.filter ?? null,
      once,
    };

    const existing = this.#subscriptions.get(type) ?? [];
    existing.push(stored);

    // Sorted on insert rather than on dispatch: subscription happens once at
    // startup, dispatch happens on every event. A stable sort keeps equal
    // priorities in registration order.
    existing.sort((a, b) => b.priority - a.priority);
    this.#subscriptions.set(type, existing);

    return () => {
      this.#remove(type, erased);
    };
  }

  #remove(type: string, handler: EventHandler<never>): boolean {
    const existing = this.#subscriptions.get(type);
    if (existing === undefined) return false;

    const index = existing.findIndex((entry) => entry.handler === handler);
    if (index === -1) return false;

    existing.splice(index, 1);
    if (existing.length === 0) this.#subscriptions.delete(type);
    return true;
  }

  /** Registered subscriptions for a type, highest priority first. Diagnostics only. */
  subscriptionsFor<TType extends DomainEventType>(
    type: TType,
  ): readonly Subscription<TType>[] {
    return (this.#subscriptions.get(type) ?? []).map((entry) => ({
      type,
      name: entry.name,
      priority: entry.priority,
      handler: entry.handler as EventHandler<EventOfType<TType>>,
      filter: entry.filter as EventFilter<EventOfType<TType>> | null,
      once: entry.once,
    }));
  }

  /** Test and shutdown affordance. Removes every subscription. */
  clear(): void {
    this.#subscriptions.clear();
  }
}

/**
 * Local timeout signal.
 *
 * Defined here rather than imported from `errors/` to keep the bus module free
 * of a cycle through the barrel; the exported `HandlerTimeoutError` wraps the
 * same condition for consumers.
 */
class HandlerTimeout extends Error {
  constructor(eventType: string, timeoutMs: number) {
    super(`Handler for ${eventType} exceeded ${timeoutMs}ms.`);
    this.name = 'HandlerTimeoutError';
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

  once(): Unsubscribe {
    return () => {};
  }

  unsubscribe(): boolean {
    return false;
  }

  typesEmitted(): readonly string[] {
    return this.#recorded.map((event) => event.type);
  }

  /**
   * Drafts of one type, for asserting on payloads without hand-filtering.
   *
   * The return type is rebuilt from `EventOfType` rather than `Extract`-ed from
   * `AnyEventDraft`: that alias holds the whole type union in one field, so
   * extracting a single member from it yields `never` and the payload is lost.
   */
  ofType<TType extends DomainEventType>(
    type: TType,
  ): readonly EventDraft<TType, EventOfType<TType>['payload']>[] {
    return this.#recorded.filter(
      (event): event is EventDraft<TType, EventOfType<TType>['payload']> =>
        event.type === type,
    );
  }

  clear(): void {
    this.#recorded.length = 0;
  }
}
