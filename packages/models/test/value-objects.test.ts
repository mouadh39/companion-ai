import { describe, expect, it } from 'vitest';
import {
  aggregateOf,
  between,
  clampUnit,
  compareTimestamps,
  confidence,
  duration,
  EMPTY_METADATA,
  firstPage,
  importance,
  isComparable,
  isMetadata,
  isToolId,
  isUuidV7,
  MAX_METADATA_KEYS,
  MAX_PAGE_SIZE,
  parseTimestamp,
  parseUnit,
  timestamp,
  valence,
} from '@nexa/models';

/**
 * The vocabulary is types, so most of it is checked by the compiler rather than
 * here. What these cover is the part that survives to runtime: the value-object
 * invariants, which are the only place `@nexa/models` can fail at execution
 * time — and the only place a bad value can enter the domain and be persisted.
 */

describe('bounded scores', () => {
  it('accepts the full closed range', () => {
    expect(confidence(0)).toBe(0);
    expect(confidence(1)).toBe(1);
    expect(importance(0.5)).toBe(0.5);
    expect(valence(-1)).toBe(-1);
    expect(valence(1)).toBe(1);
  });

  it('rejects values outside the range', () => {
    expect(() => confidence(1.0001)).toThrow(RangeError);
    expect(() => confidence(-0.0001)).toThrow(RangeError);
    expect(() => importance(2)).toThrow(RangeError);
  });

  it('rejects non-finite input, which is how NaN reaches storage', () => {
    expect(() => confidence(Number.NaN)).toThrow(RangeError);
    expect(() => confidence(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });

  it('separates the signed range from the unit range', () => {
    // A valence of -0.5 is meaningful; a confidence of -0.5 is a bug.
    expect(valence(-0.5)).toBe(-0.5);
    expect(() => confidence(-0.5)).toThrow(RangeError);
  });

  it('parses untrusted input without throwing', () => {
    expect(parseUnit(0.7)).toBe(0.7);
    expect(parseUnit(1.5)).toBeNull();
    expect(parseUnit('high')).toBeNull();
    expect(parseUnit(null)).toBeNull();
  });

  it('clamps computed values rather than rejecting them', () => {
    expect(clampUnit(1.0000001)).toBe(1);
    expect(clampUnit(-3)).toBe(0);
    expect(clampUnit(Number.NaN)).toBe(0);
  });
});

describe('timestamps', () => {
  const iso = '2026-07-29T12:00:00.000Z';

  it('accepts ISO 8601 UTC with milliseconds', () => {
    expect(timestamp(iso)).toBe(iso);
  });

  it('rejects forms that would break lexicographic ordering', () => {
    expect(() => timestamp('2026-07-29T12:00:00Z')).toThrow(RangeError);
    expect(() => timestamp('2026-07-29T12:00:00.000+01:00')).toThrow(RangeError);
    expect(() => timestamp('29/07/2026')).toThrow(RangeError);
  });

  it('rejects a well-formed string that is not a real instant', () => {
    expect(() => timestamp('2026-02-30T00:00:00.000Z')).toThrow(RangeError);
  });

  it('parses untrusted input without throwing', () => {
    expect(parseTimestamp(iso)).toBe(iso);
    expect(parseTimestamp('nonsense')).toBeNull();
    expect(parseTimestamp(1_753_790_400_000)).toBeNull();
  });

  it('sorts chronologically by string comparison', () => {
    const earlier = timestamp('2026-07-29T11:00:00.000Z');
    const later = timestamp('2026-07-29T12:00:00.000Z');
    expect(compareTimestamps(earlier, later)).toBeLessThan(0);
    expect(compareTimestamps(later, earlier)).toBeGreaterThan(0);
    expect(compareTimestamps(later, later)).toBe(0);
  });

  it('measures a span, and refuses a reversed one', () => {
    const start = timestamp('2026-07-29T12:00:00.000Z');
    const end = timestamp('2026-07-29T12:00:01.500Z');
    expect(between(start, end)).toBe(1500);
    expect(() => between(end, start)).toThrow(RangeError);
  });

  it('rejects a negative duration', () => {
    expect(duration(0)).toBe(0);
    expect(() => duration(-1)).toThrow(RangeError);
  });
});

describe('metadata', () => {
  it('accepts a flat bag of primitives', () => {
    expect(isMetadata({ source: 'unity', retries: 2, ok: true, note: null })).toBe(true);
    expect(isMetadata(EMPTY_METADATA)).toBe(true);
  });

  it('rejects nesting, so structure cannot be smuggled in untyped', () => {
    expect(isMetadata({ nested: { a: 1 } })).toBe(false);
    expect(isMetadata({ list: [1, 2] })).toBe(false);
  });

  it('rejects non-objects', () => {
    expect(isMetadata(null)).toBe(false);
    expect(isMetadata([])).toBe(false);
    expect(isMetadata('meta')).toBe(false);
  });

  it('enforces the key ceiling', () => {
    const tooMany = Object.fromEntries(
      Array.from({ length: MAX_METADATA_KEYS + 1 }, (_, i) => [`k${i}`, i]),
    );
    expect(isMetadata(tooMany)).toBe(false);
  });
});

describe('identifiers', () => {
  it('recognises a v7 uuid and rejects a v4', () => {
    expect(isUuidV7('01920000-0000-7000-8000-000000000000')).toBe(true);
    expect(isUuidV7('01920000-0000-4000-8000-000000000000')).toBe(false);
    expect(isUuidV7('not-a-uuid')).toBe(false);
  });

  it('constrains tool names to what a model reproduces reliably', () => {
    expect(isToolId('calendar.createEvent')).toBe(false);
    expect(isToolId('calendar.create')).toBe(true);
    expect(isToolId('Calendar Create Event')).toBe(false);
    expect(isToolId('calendar')).toBe(false);
  });
});

describe('embedding references', () => {
  const ref = (model: string, dimensions: number) => ({
    vectorId: 'v1',
    model,
    dimensions,
    embeddedAt: timestamp('2026-07-29T12:00:00.000Z'),
  });

  it('refuses to compare vectors from different models', () => {
    expect(isComparable(ref('voyage-3', 1024), ref('voyage-3', 1024))).toBe(true);
    expect(isComparable(ref('voyage-3', 1024), ref('openai-3-large', 1024))).toBe(false);
    expect(isComparable(ref('voyage-3', 1024), ref('voyage-3', 512))).toBe(false);
  });
});

describe('events', () => {
  it('reads the aggregate out of a namespaced type', () => {
    expect(aggregateOf('nexa.memory.stored')).toBe('memory');
    expect(aggregateOf('nexa.goal.completed')).toBe('goal');
  });

  it('returns null for an unknown type rather than throwing', () => {
    // A consumer must tolerate events written by newer code; refusing to parse
    // one is how a rolling deploy becomes an outage.
    expect(aggregateOf('nexa.something.happened')).toBeNull();
    expect(aggregateOf('malformed')).toBeNull();
  });
});

describe('pagination', () => {
  it('starts unbounded-safe and newest-first', () => {
    const page = firstPage();
    expect(page.after).toBeNull();
    expect(page.direction).toBe('backward');
  });

  it('caps the requested limit', () => {
    expect(firstPage(10_000).limit).toBe(MAX_PAGE_SIZE);
    expect(firstPage(0).limit).toBe(1);
  });
});
