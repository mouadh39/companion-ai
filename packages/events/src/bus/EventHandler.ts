import type { DomainEvent, DomainEventType, EventOfType } from '../events/index.js';

/**
 * What a subscriber runs when an event arrives.
 *
 * Returns `Promise<void>` — nothing, deliberately. A handler with a return
 * value is a port wearing a costume, and `06_Event_System.md` gives the test:
 * if you need the answer, it is not an event. The type signature is where that
 * rule is enforced rather than reviewed.
 */
export type EventHandler<TEvent> = (event: TEvent) => Promise<void>;

/** Cancels a subscription. Returned by `subscribe` and `once`. */
export type Unsubscribe = () => void;

/**
 * A predicate deciding whether one subscription cares about one event.
 *
 * Per-subscription, evaluated before the handler runs. Filtering here rather
 * than with an early `return` inside the handler keeps "did this handler
 * decline?" distinguishable from "did this handler do nothing?" in the
 * lifecycle hooks — which is the difference between a working filter and a
 * silently broken handler.
 *
 * Must be pure and synchronous. A filter that performs I/O is a handler.
 */
export type EventFilter<TEvent> = (event: TEvent) => boolean;

/**
 * Dispatch-order hint within a single process.
 *
 * **This is not an ordering guarantee, and must never be relied on for
 * correctness.** Three reasons, each sufficient on its own:
 *
 * 1. `06_Event_System.md` specifies that handlers for one event run
 *    concurrently and that ordering between them is not provided.
 * 2. Handlers are invoked without being awaited, so priority orders the
 *    *start* of each handler, never its completion.
 * 3. It cannot survive the Redis transport, where handlers live in separate
 *    consumer processes with no shared ordering at all.
 *
 * It exists for local concerns where start order is a convenience and nothing
 * breaks when it is ignored — attaching a tracing listener before the handlers
 * it observes, for instance. If two handlers genuinely must run in sequence,
 * that is one handler, or a sequenced pipeline; it is not a bus.
 *
 * Higher runs first. Equal priorities run in subscription order.
 */
export type HandlerPriority = number;

export const PRIORITY = {
  /** Observability that should start before business handlers. */
  monitor: 100,
  high: 50,
  normal: 0,
  low: -50,
} as const satisfies Readonly<Record<string, HandlerPriority>>;

/** Options accepted when registering a subscription. */
export interface SubscribeOptions<TEvent> {
  /** See `HandlerPriority` — a local hint, never a guarantee. */
  readonly priority?: HandlerPriority;
  /** Declines events this subscription does not care about. */
  readonly filter?: EventFilter<TEvent>;
  /** Human-readable name. Appears in error reports and lifecycle hooks. */
  readonly name?: string;
}

/**
 * A registered subscription, as the bus holds it.
 *
 * Exposed because the lifecycle hooks report against it: an error naming
 * `"memory-writer"` is actionable, one naming an anonymous closure is not.
 */
export interface Subscription<TType extends DomainEventType = DomainEventType> {
  readonly type: TType;
  readonly name: string;
  readonly priority: HandlerPriority;
  readonly handler: EventHandler<EventOfType<TType>>;
  readonly filter: EventFilter<EventOfType<TType>> | null;
  /** True when the subscription removes itself after its first delivery. */
  readonly once: boolean;
}

/** Context passed to lifecycle hooks alongside the event. */
export interface HandlerContext {
  readonly eventId: string;
  readonly eventType: string;
  readonly handlerName: string;
  /** Milliseconds the handler ran. Present only on completion hooks. */
  readonly durationMs?: number;
}

/**
 * Why an event was not delivered to a given subscription.
 *
 * Recorded rather than inferred, for the same reason context omissions are in
 * `@nexa/models`: "the filter declined" and "no one was listening" call for
 * different responses, and a silent non-delivery cannot tell you which happened.
 */
export type DropReason = 'filtered' | 'no_subscribers' | 'middleware_veto';

/**
 * Observability seams on the bus.
 *
 * Every hook is optional and synchronous, and none may throw — a hook that
 * fails must not take down a dispatch. The bus guards them, but the contract is
 * stated here because a throwing hook is a bug worth not writing.
 */
export interface EventBusLifecycle {
  /** After an event is accepted and stamped, before any handler is invoked. */
  readonly onPublished?: (event: DomainEvent) => void;
  /** After a handler resolves successfully. */
  readonly onHandlerSucceeded?: (event: DomainEvent, context: HandlerContext) => void;
  /** After a handler rejects. Failures never propagate to the publisher. */
  readonly onHandlerFailed?: (
    event: DomainEvent,
    context: HandlerContext,
    error: unknown,
  ) => void;
  /** When an event reaches no handler, or is declined before one runs. */
  readonly onDropped?: (event: DomainEvent, reason: DropReason) => void;
}
