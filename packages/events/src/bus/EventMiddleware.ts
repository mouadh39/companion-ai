import type { DomainEvent } from '../events/index.js';

/**
 * Cross-cutting behaviour wrapped around every dispatch.
 *
 * Onion shape: each middleware receives the event and a `next` continuation,
 * and chooses whether to call it. Not calling `next` vetoes the dispatch, which
 * is how bus-wide filtering, sampling and kill-switches are expressed without
 * every handler learning about them.
 *
 * **Middleware may not mutate the event.** The whole system rests on events
 * being immutable facts — the log is append-only, replay must reproduce what
 * happened, and a middleware that rewrites a payload makes the stored event a
 * lie. `DomainEvent` is deeply `readonly`, so the compiler enforces this; the
 * rule is restated because casting around it would be easy and catastrophic.
 *
 * Middleware runs once per event, around the whole fan-out to subscribers —
 * not once per handler. Per-handler concerns belong in a handler decorator; see
 * `oncePerEvent` in `utils`.
 */
export type EventMiddleware = (
  event: DomainEvent,
  next: () => Promise<void>,
) => Promise<void>;

/**
 * Composes middleware into a single function, first listed running outermost.
 *
 * Guards against the classic onion bug: a middleware that calls `next()` twice
 * would fan the rest of the chain out twice, duplicating every delivery. That
 * failure is intermittent and extremely hard to trace from the symptom, so it
 * is made impossible here rather than documented.
 */
export const composeMiddleware = (
  middleware: readonly EventMiddleware[],
): EventMiddleware => {
  if (middleware.length === 0) {
    return async (_event, next) => {
      await next();
    };
  }

  return async (event, next) => {
    let index = -1;

    const dispatch = async (i: number): Promise<void> => {
      if (i <= index) {
        throw new Error('Middleware called next() more than once.');
      }
      index = i;

      const layer = middleware[i];
      if (layer === undefined) {
        await next();
        return;
      }

      await layer(event, () => dispatch(i + 1));
    };

    await dispatch(0);
  };
};

/**
 * Drops events whose type is not in the allow-list.
 *
 * Useful in a worker that consumes one slice of the catalogue: subscribing
 * selectively already does this, but a bus-level guard makes an accidental
 * subscription in the wrong process fail visibly rather than quietly doing work
 * that belongs elsewhere.
 */
export const allowOnly = (types: readonly string[]): EventMiddleware => {
  const allowed = new Set(types);
  return async (event, next) => {
    if (allowed.has(event.type)) await next();
  };
};

/**
 * Drops ephemeral events.
 *
 * For a persistence consumer: perception fires at frame rate and must never
 * reach the event log. Expressed as middleware so the rule lives in one place
 * rather than as a condition every writer remembers to include.
 */
export const persistentOnly: EventMiddleware = async (event, next) => {
  if (event.durability === 'persistent') await next();
};
