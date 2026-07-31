/**
 * The event vocabulary this layer owns.
 *
 * The envelope itself is **not** here. `@nexa/events` defines `EventEnvelope`,
 * because the envelope carries transport concerns — `source`, `durability`,
 * `causedBy` — that only the bus can stamp, and a second envelope shape at this
 * layer was a type nothing constructed and nothing read.
 *
 * What remains is the part every layer genuinely shares: how an event's
 * namespaced type string maps to the aggregate it is a fact *about*. That
 * mapping has to be readable by code holding a persisted row with no dependency
 * on the transport that wrote it, which is the whole premise of an append-only
 * log replayed years later.
 *
 * The rule from `06_Event_System.md`, restated because it is the one most
 * easily broken: **if you need the return value, it is not an event.** Past
 * tense, immutable, and the emitter does not care whether anyone listens.
 */

/**
 * The subject an event is about.
 *
 * Used for filtering and for per-aggregate ordering guarantees. Kept as a small
 * closed union because these are the things Nexa emits facts *about*; the event
 * types themselves stay open.
 */
export type EventAggregate =
  | 'turn'
  | 'decision'
  | 'action'
  | 'memory'
  | 'goal'
  | 'emotion'
  | 'relationship'
  | 'conversation'
  | 'tool'
  | 'voice'
  | 'world';

export const EVENT_AGGREGATES = [
  'turn',
  'decision',
  'action',
  'memory',
  'goal',
  'emotion',
  'relationship',
  'conversation',
  'tool',
  'voice',
  'world',
] as const satisfies readonly EventAggregate[];

/**
 * Reads the aggregate out of a namespaced type string.
 *
 * `nexa.memory.stored` → `memory`. Returns null rather than throwing on an
 * unrecognised type: consumers must tolerate events written by newer code, and
 * refusing to parse one is how a rolling deploy turns into an outage.
 */
export const aggregateOf = (type: string): EventAggregate | null => {
  const segment = type.split('.')[1];
  return segment !== undefined &&
    (EVENT_AGGREGATES as readonly string[]).includes(segment)
    ? (segment as EventAggregate)
    : null;
};

/** The delivery guarantee, stated in the domain so handlers cannot claim not to know. */
export const DELIVERY_GUARANTEE = 'at-least-once' as const;
