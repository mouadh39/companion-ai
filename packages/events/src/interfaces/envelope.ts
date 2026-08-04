import type { CompanionId, EventId, TurnId, UserId } from '@nexa/shared';
import type { Metadata } from '@nexa/models';
import { EMPTY_METADATA } from '@nexa/models';

/**
 * Which subsystem emitted an event.
 *
 * Stamped from the event's definition rather than passed per call, because the
 * owner of a fact is a property of the fact: `nexa.memory.stored` is always the
 * memory engine's. Once the bus spans processes this is the first field anyone
 * reads when an event arrives that should not have — "who published this?" is
 * otherwise answerable only by grepping every package.
 */
export type EventSource =
  | 'turn'
  | 'memory'
  | 'decision'
  | 'planning'
  | 'personality'
  | 'emotion'
  | 'relationship'
  | 'reflection'
  | 'conversation'
  | 'tools'
  | 'voice'
  | 'vision'
  | 'world'
  | 'client'
  | 'system';

export const EVENT_SOURCES = [
  'turn',
  'memory',
  'decision',
  'planning',
  'personality',
  'emotion',
  'relationship',
  'reflection',
  'conversation',
  'tools',
  'voice',
  'vision',
  'world',
  'client',
  'system',
] as const satisfies readonly EventSource[];

/**
 * Whether an event belongs in the append-only log.
 *
 * The distinction exists because perception does not scale like cognition. A
 * headset emitting object detections at 30–60 Hz produces millions of rows per
 * user per day, on the same table reflection and analytics must scan — while
 * carrying almost no information worth keeping once the frame is gone.
 *
 * - `persistent` — written to the event log. The default, and what every fact
 *   about the companion's cognition must be.
 * - `ephemeral` — delivered to handlers, never written. Live signal only; a
 *   consumer that needs history from one of these is using the wrong event.
 *
 * Chosen per event type at definition time, so the classification is visible
 * next to the payload rather than buried in a persistence adapter.
 */
export type EventDurability = 'persistent' | 'ephemeral';

/**
 * The envelope every domain event carries. Payloads vary; this never does.
 *
 * See `docs/specifications/Event_API.md` for the normative contract. Field
 * names there are authoritative; where the Milestone 3 brief used different
 * spellings the mapping is: `eventId` → `id`, `eventType` → `type`,
 * `timestamp` → `occurredAt`, `correlationId` → `turnId`,
 * `causationId` → `causedBy`. Renaming was rejected as churn that would break
 * two consumers and stale two accepted specifications for no behavioural gain.
 */
export interface EventEnvelope<TType extends string, TPayload> {
  /** UUID v7 — time-ordered, and the idempotency key for every handler. */
  readonly id: EventId;
  readonly type: TType;
  /** Payload schema version. Increments additively; never breaks. */
  readonly version: number;
  /** Emission time, ISO 8601 UTC. Stamped by the bus, never by the caller. */
  readonly occurredAt: string;

  /** Partition key. Ordering is per-companion; nothing is ordered globally. */
  readonly companionId: CompanionId;
  /** On every event, so "delete everything about me" is one indexed predicate. */
  readonly userId: UserId;

  /**
   * The turn that produced this event, when there was one.
   *
   * This is the correlation id: everything one user message caused shares it.
   * Null for events with no turn — session lifecycle, autonomous perception.
   */
  readonly turnId: TurnId | null;
  /** Causation. The event that caused this one. Null when user-initiated. */
  readonly causedBy: EventId | null;

  /** Which subsystem emitted it. From the event definition, not the call site. */
  readonly source: EventSource;
  /** Whether this belongs in the append-only log. From the event definition. */
  readonly durability: EventDurability;

  readonly payload: TPayload;

  /**
   * Open annotation — trace ids, client build, experiment arm.
   *
   * Flat primitives only and capped at 32 keys by `@nexa/models`. The limit is
   * the design: metadata rides along on every read of the event, so an
   * unbounded bag is unbounded cost on the hottest path in the system. Anything
   * that needs structure belongs in the payload, where it has a schema.
   */
  readonly metadata: Metadata;
}

/**
 * Correlation supplied by the emitter. The bus fills in `id` and `occurredAt`.
 *
 * Splitting it this way removes the two most common event bugs — a hand-written
 * timestamp and a forgotten `causedBy` — by construction rather than by review.
 */
export interface EventCorrelation {
  readonly companionId: CompanionId;
  readonly userId: UserId;
  readonly turnId: TurnId | null;
  readonly causedBy: EventId | null;
}

/** An event before the bus has stamped identity and time onto it. */
export type EventDraft<TType extends string, TPayload> = Omit<
  EventEnvelope<TType, TPayload>,
  'id' | 'occurredAt'
>;

/** Static properties of an event type, fixed at definition. */
export interface EventDefinitionOptions {
  readonly source: EventSource;
  /** Defaults to `persistent`. Opt out only for high-frequency live signal. */
  readonly durability?: EventDurability;
}

/**
 * A draft factory for one event type, with its definition attached.
 *
 * The attached metadata is what `EventRegistry` reads, so the catalogue can be
 * enumerated at runtime without a second hand-maintained list beside it.
 */
export interface EventFactory<TType extends string, TPayload> {
  (correlation: EventCorrelation, payload: TPayload, metadata?: Metadata): EventDraft<
    TType,
    TPayload
  >;
  readonly type: TType;
  readonly version: number;
  readonly source: EventSource;
  readonly durability: EventDurability;
}

/**
 * Builds a typed draft factory for one event type.
 *
 * Every event in the catalogue is declared through this, so the type string,
 * version, source and durability live in exactly one place per event and cannot
 * drift apart.
 */
export const defineEvent = <TType extends string, TPayload>(
  type: TType,
  version: number,
  options: EventDefinitionOptions,
): EventFactory<TType, TPayload> => {
  const durability: EventDurability = options.durability ?? 'persistent';

  const factory = (
    correlation: EventCorrelation,
    payload: TPayload,
    metadata: Metadata = EMPTY_METADATA,
  ): EventDraft<TType, TPayload> => ({
    type,
    version,
    companionId: correlation.companionId,
    userId: correlation.userId,
    turnId: correlation.turnId,
    causedBy: correlation.causedBy,
    source: options.source,
    durability,
    payload,
    metadata,
  });

  return Object.assign(factory, {
    type,
    version,
    source: options.source,
    durability,
  });
};
