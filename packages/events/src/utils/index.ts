import type { DomainEvent } from '../events/index.js';
import type { EventFilter, EventHandler } from '../bus/EventHandler.js';

/**
 * Handler decorators and filter builders.
 *
 * Everything here composes around a handler rather than being configured into
 * the bus. That is the difference between a bus that grows a flag for every
 * requirement and one that stays small while callers assemble what they need.
 */

/**
 * Makes a handler safe under at-least-once delivery.
 *
 * **This is the important one.** `06_Event_System.md` states that idempotency
 * is mandatory, not optional discipline: a handler may see the same event more
 * than once, and a non-idempotent memory writer under redelivery produces
 * exactly the duplicate memories `18_Memory_Architecture.md` names as a known
 * risk — intermittently, under load, weeks after the code was written.
 *
 * Keys on `event.id`, which is the documented idempotency key.
 *
 * The in-memory `seen` set is bounded and process-local, which makes this
 * correct for the in-process bus and a *starting point* for Redis: durable
 * deduplication needs a shared store, and the handler shape stays identical
 * when that arrives.
 */
export const oncePerEvent = <TEvent extends { readonly id: string }>(
  handler: EventHandler<TEvent>,
  options: { readonly capacity?: number } = {},
): EventHandler<TEvent> => {
  const capacity = options.capacity ?? 10_000;
  const seen = new Set<string>();

  return async (event) => {
    if (seen.has(event.id)) return;

    // Recorded before running, not after: a handler that throws must not be
    // retried by *this* guard. Retry policy belongs to the transport, which
    // knows how many attempts have been made; a guard that forgets on failure
    // would silently convert one delivery into unbounded re-execution.
    seen.add(event.id);

    // Oldest-first eviction. Sets preserve insertion order, so the first key is
    // the oldest. Bounded because an unbounded dedup set is a memory leak with
    // a long fuse.
    if (seen.size > capacity) {
      const oldest = seen.values().next();
      if (!oldest.done) seen.delete(oldest.value);
    }

    await handler(event);
  };
};

/**
 * Gives a handler a name that survives minification.
 *
 * Lifecycle hooks report `handlerName`, and an error naming `"memory-writer"`
 * is actionable where one naming an anonymous arrow function is not.
 */
export const named = <TEvent>(
  name: string,
  handler: EventHandler<TEvent>,
): EventHandler<TEvent> => Object.defineProperty(handler, 'name', { value: name });

/**
 * Runs a handler only for events concerning one companion.
 *
 * A filter rather than a wrapper, because declining should be visible to the
 * `onDropped` hook rather than looking like a handler that did nothing.
 */
export const forCompanion =
  <TEvent extends DomainEvent>(companionId: string): EventFilter<TEvent> =>
  (event) =>
    event.companionId === companionId;

/** Runs a handler only for events concerning one user. */
export const forUser =
  <TEvent extends DomainEvent>(userId: string): EventFilter<TEvent> =>
  (event) =>
    event.userId === userId;

/** Runs a handler only for events produced by a specific turn. */
export const forTurn =
  <TEvent extends DomainEvent>(turnId: string): EventFilter<TEvent> =>
  (event) =>
    event.turnId === turnId;

/** Runs a handler only for events that belong in the log. */
export const persistentOnlyFilter =
  <TEvent extends DomainEvent>(): EventFilter<TEvent> =>
  (event) =>
    event.durability === 'persistent';

/** Combines filters — all must pass. */
export const every =
  <TEvent>(...filters: readonly EventFilter<TEvent>[]): EventFilter<TEvent> =>
  (event) =>
    filters.every((filter) => filter(event));

/** Combines filters — any may pass. */
export const some =
  <TEvent>(...filters: readonly EventFilter<TEvent>[]): EventFilter<TEvent> =>
  (event) =>
    filters.some((filter) => filter(event));

/** Inverts a filter. */
export const not =
  <TEvent>(filter: EventFilter<TEvent>): EventFilter<TEvent> =>
  (event) =>
    !filter(event);
