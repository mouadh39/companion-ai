/**
 * Cursor pagination.
 *
 * Cursors rather than offsets, and this is the scale decision that shows up
 * earliest. `OFFSET 50000` makes the database walk fifty thousand rows to
 * discard them, so the deepest pages are the slowest — and a companion's
 * history is browsed from the far end, where the offsets are largest. A cursor
 * turns every page into an indexed seek at constant cost.
 *
 * It also fixes the correctness bug offsets have: memories are written
 * continuously, so between two offset reads the window shifts and rows are
 * silently skipped or repeated. Nexa's ids are UUID v7 and therefore already
 * chronologically sortable, which means the id *is* the cursor and no
 * additional column is needed.
 *
 * These are shapes only. No query is executed here — repositories belong to
 * capability packages, not to the vocabulary.
 */
export interface PageRequest {
  /**
   * The id to resume after, or null to start from the beginning.
   *
   * Exclusive, so the row that produced the cursor is not returned twice.
   */
  readonly after: string | null;
  /** How many items to return. Callers must expect fewer. */
  readonly limit: number;
  /** Newest-first by default: recent history is what gets read. */
  readonly direction: PageDirection;
}

export type PageDirection = 'forward' | 'backward';

export interface Page<TItem> {
  readonly items: readonly TItem[];
  /**
   * Cursor for the next request, or null when the end was reached.
   *
   * Null means *this* page ended the sequence. An empty `items` array with a
   * non-null cursor is legal — a filtered page may return nothing and still
   * have more behind it.
   */
  readonly nextCursor: string | null;
  /**
   * Whether more items exist.
   *
   * Carried explicitly rather than inferred from `items.length === limit`,
   * which is wrong exactly once per sequence: a final page that happens to be
   * full is indistinguishable from a full one with more behind it.
   */
  readonly hasMore: boolean;
}

/**
 * Default page size.
 *
 * Twenty because that is roughly what a person reads at once, and because the
 * cost of a second request is far lower than the cost of over-fetching on every
 * first one.
 */
export const DEFAULT_PAGE_SIZE = 20;

/**
 * Hard ceiling on page size.
 *
 * Bounds the worst-case response regardless of what a caller asks for. An
 * unbounded `limit` is a denial-of-service vector that looks like a feature
 * request.
 */
export const MAX_PAGE_SIZE = 100;

/** The first page, newest-first. */
export const firstPage = (limit: number = DEFAULT_PAGE_SIZE): PageRequest => ({
  after: null,
  limit: Math.min(Math.max(1, limit), MAX_PAGE_SIZE),
  direction: 'backward',
});
