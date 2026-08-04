import { NexaError } from '@nexa/shared';

/**
 * Failures the event system raises deliberately.
 *
 * All extend `NexaError`, so they carry a stable `code` that operational
 * tooling can aggregate. A human-readable message is not aggregatable, and
 * "how often are handlers dead-lettering?" is a question worth answering with a
 * number.
 *
 * None of these ever reach a publisher. `06_Event_System.md` is explicit that a
 * handler failure must not fail the emitter — these describe failures for the
 * error reporter and the dead-letter path, not for a `throw` that propagates.
 */

/** A handler threw. Carries enough context to find the event in the log. */
export class HandlerFailedError extends NexaError {
  constructor(
    readonly eventId: string,
    readonly eventType: string,
    cause: unknown,
  ) {
    super('event_handler_failed', `Handler for ${eventType} failed.`, {
      cause,
      context: { eventId, eventType },
    });
  }
}

/**
 * A handler exceeded its time budget.
 *
 * Separate from a generic failure because the remedy differs: a throwing
 * handler is a bug, a slow one is capacity. `06_Event_System.md` requires slow
 * handlers to be isolated by timeout so one cannot stall the stream.
 */
export class HandlerTimeoutError extends NexaError {
  constructor(
    readonly eventType: string,
    readonly timeoutMs: number,
  ) {
    super(
      'event_handler_timeout',
      `Handler for ${eventType} exceeded ${timeoutMs}ms.`,
      { context: { eventType, timeoutMs } },
    );
  }
}

/**
 * An event type arrived that the registry does not know.
 *
 * Raised by the registry on lookup, never by the bus on delivery. A consumer
 * must tolerate events written by newer code — refusing to deliver one is how a
 * rolling deploy becomes an outage.
 */
export class UnknownEventTypeError extends NexaError {
  constructor(readonly eventType: string) {
    super('event_type_unknown', `No definition registered for ${eventType}.`, {
      context: { eventType },
    });
  }
}

/**
 * Two definitions claimed the same event type.
 *
 * A startup failure, deliberately. Duplicate registration means two payload
 * shapes share one wire format, and the resulting corruption is invisible until
 * something replays the log months later.
 */
export class DuplicateEventTypeError extends NexaError {
  constructor(readonly eventType: string) {
    super('event_type_duplicate', `${eventType} is already registered.`, {
      context: { eventType },
    });
  }
}

/**
 * Retries were exhausted and the event moved to the dead-letter stream.
 *
 * Never silently dropped: `06_Event_System.md` requires an alert here, and a
 * typed error is what an alerting rule can key on.
 */
export class DeadLetteredError extends NexaError {
  constructor(
    readonly eventId: string,
    readonly eventType: string,
    readonly attempts: number,
  ) {
    super(
      'event_dead_lettered',
      `${eventType} dead-lettered after ${attempts} attempts.`,
      { context: { eventId, eventType, attempts } },
    );
  }
}
