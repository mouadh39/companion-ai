import type { JsonPrimitive } from '../types/json.js';

/**
 * Open-ended annotation attached to a domain object.
 *
 * Deliberately shallow — primitives only, no nested objects or arrays. The
 * depth limit is the whole design. An unrestricted metadata bag becomes the
 * place every feature stores the field it did not want to model, and within a
 * year it holds structure nothing validates, nothing migrates, and everything
 * depends on. Keeping it flat makes it *inconvenient* to smuggle a real entity
 * in here, which is the point: if it needs nesting, it needs a type.
 *
 * Flat primitives are also directly indexable as a JSONB column and cheap to
 * filter on, which is what makes this usable at scale rather than merely
 * permitted.
 */
export type MetadataValue = JsonPrimitive;

export type Metadata = Readonly<Record<string, MetadataValue>>;

/** The empty bag. Shared so absent metadata does not allocate per object. */
export const EMPTY_METADATA: Metadata = Object.freeze({});

/**
 * Caps how many keys one bag may carry.
 *
 * Not arbitrary: metadata rides along on every read of its parent, so an
 * unbounded bag is unbounded cost on a hot path. Hitting this limit is a signal
 * that the data wants a table, not a key.
 */
export const MAX_METADATA_KEYS = 32;

/**
 * Narrows `unknown` to `Metadata`.
 *
 * The realistic source is a database column or a client payload, neither of
 * which the compiler can vouch for. Rejects nested structures explicitly rather
 * than accepting and flattening them — silently discarding a caller's data is
 * worse than refusing it.
 */
export const isMetadata = (value: unknown): value is Metadata => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;

  const entries = Object.entries(value);
  if (entries.length > MAX_METADATA_KEYS) return false;

  return entries.every(([, item]) =>
    item === null ||
    typeof item === 'string' ||
    typeof item === 'number' ||
    typeof item === 'boolean',
  );
};
