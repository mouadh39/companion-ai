import type { Brand } from '../types/brand.js';

/**
 * An instant, as an ISO 8601 string in UTC.
 *
 * A string rather than a `Date`, and the choice is load-bearing. `Date` is
 * mutable, carries a local timezone that differs between the API process and
 * the worker, and does not survive a JSON round trip — it deserialises as a
 * string, so half the system would hold `Date` and the other half `string`
 * under one type. The event log is append-only and replayed years later; the
 * stored form and the in-memory form must be the same form.
 *
 * UTC always. A companion whose memories are ordered differently depending on
 * where its owner was standing is not a companion with a memory.
 */
export type Timestamp = Brand<string, 'Timestamp'>;

/**
 * A wall-clock span in milliseconds.
 *
 * Non-negative and finite: a negative duration is always a subtraction done in
 * the wrong order, which is worth catching where it happens rather than three
 * layers later where it surfaces as a nonsensical metric.
 */
export type Duration = Brand<number, 'Duration'>;

/** Matches ISO 8601 with milliseconds and an explicit `Z`. The one form Nexa writes. */
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/**
 * True when the string is both well-formed and names a real instant.
 *
 * The round trip is what does the work. `Date.parse` is not a validator:
 * `2026-02-30` parses happily and silently becomes March 2nd, so a check based
 * on `NaN` alone accepts a date that does not exist and then stores a different
 * one. Re-serialising and comparing is the only way to catch that rollover.
 */
const isRealInstant = (value: string): boolean => {
  if (!ISO_UTC.test(value)) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
};

/**
 * Adopts an ISO 8601 UTC string as a `Timestamp`.
 *
 * Validates the shape *and* that it names a real instant — `2026-02-30` matches
 * the pattern and is not a date. Throws on rejection, because every internal
 * caller passes the output of `Clock.nowIso()`, and a malformed timestamp
 * reaching persistence corrupts ordering in a store that is append-only and
 * therefore cannot be repaired in place.
 */
export const timestamp = (value: string): Timestamp => {
  if (!isRealInstant(value)) {
    throw new RangeError(
      `Timestamp must be ISO 8601 UTC with milliseconds (YYYY-MM-DDTHH:mm:ss.sssZ); received ${value}`,
    );
  }
  return value as Timestamp;
};

/** Non-throwing variant for untrusted input. Returns `null` rather than guessing. */
export const parseTimestamp = (value: unknown): Timestamp | null =>
  typeof value === 'string' && isRealInstant(value) ? (value as Timestamp) : null;

export const duration = (milliseconds: number): Duration => {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) {
    throw new RangeError(`Duration must be a finite, non-negative number of ms; received ${milliseconds}`);
  }
  return milliseconds as Duration;
};

/**
 * Milliseconds from `start` to `end`.
 *
 * Ordering is the caller's responsibility and the throw from `duration` is the
 * enforcement — reversed arguments produce a negative span, which is a bug
 * rather than a zero-length event.
 */
export const between = (start: Timestamp, end: Timestamp): Duration =>
  duration(Date.parse(end) - Date.parse(start));

/**
 * Chronological comparator. Negative when `a` precedes `b`.
 *
 * Lexicographic comparison is correct for this format — fixed-width fields,
 * most significant first — so this needs no parsing and is safe to sort with.
 */
export const compareTimestamps = (a: Timestamp, b: Timestamp): number =>
  a < b ? -1 : a > b ? 1 : 0;
