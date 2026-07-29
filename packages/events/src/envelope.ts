import type { CompanionId, EventId, TurnId, UserId } from '@nexa/shared';

/**
 * The envelope every domain event carries. Payloads vary; this never does.
 *
 * See `docs/specifications/Event_API.md` for the normative contract.
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

  /** The turn that produced this event, when there was one. */
  readonly turnId: TurnId | null;
  /** The event that caused this one. Null when user-initiated. */
  readonly causedBy: EventId | null;

  readonly payload: TPayload;
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

/**
 * Builds a typed draft factory for one event type.
 *
 * Every event in the catalogue is declared through this, so the version and
 * type string live in exactly one place per event and cannot drift apart.
 */
export const defineEvent =
  <TType extends string, TPayload>(type: TType, version: number) =>
  (correlation: EventCorrelation, payload: TPayload): EventDraft<TType, TPayload> => ({
    type,
    version,
    companionId: correlation.companionId,
    userId: correlation.userId,
    turnId: correlation.turnId,
    causedBy: correlation.causedBy,
    payload,
  });
