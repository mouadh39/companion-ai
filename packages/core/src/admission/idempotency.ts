import type { Clock } from '@nexa/shared';

/**
 * Remembers what a turn produced, keyed by the caller's idempotency key.
 *
 * A mobile client on a flaky link retries. Without this, the retry is a second
 * turn: the companion answers twice, working memory gains two copies of one
 * message, and any tool the first turn called runs again. Replaying the stored
 * result instead makes a retry free and a duplicate impossible.
 *
 * Generic over the stored value so the store never depends on the turn, which
 * is what lets it be tested on its own and swapped for a shared implementation
 * without touching Core.
 */
export interface IdempotencyStore<T> {
  lookup(key: string): Promise<T | undefined>;
  remember(key: string, value: T): Promise<void>;
}

export interface IdempotencyOptions {
  /**
   * How long a result stays replayable.
   *
   * Bounded by how long a client might plausibly retry, not by how long the
   * answer stays interesting. Beyond it the key is forgotten and a retry
   * becomes a fresh turn — which is the right failure: a stale duplicate is
   * worse than an extra answer.
   */
  readonly ttlMs: number;
  /** Hard ceiling on entries, so a key-generating client cannot exhaust memory. */
  readonly maxEntries: number;
}

export const defaultIdempotencyOptions: IdempotencyOptions = {
  ttlMs: 5 * 60 * 1000,
  maxEntries: 10_000,
};

interface Entry<T> {
  readonly value: T;
  readonly storedAt: number;
}

/**
 * In-process store.
 *
 * Correct for one API process. Across several, a retry that lands on a
 * different instance is not recognised — the same limitation, and the same
 * seam, as `InProcessTurnGate`.
 */
export class InMemoryIdempotencyStore<T> implements IdempotencyStore<T> {
  readonly #entries = new Map<string, Entry<T>>();
  readonly #clock: Clock;
  readonly #options: IdempotencyOptions;

  constructor(clock: Clock, options: IdempotencyOptions = defaultIdempotencyOptions) {
    this.#clock = clock;
    this.#options = options;
  }

  async lookup(key: string): Promise<T | undefined> {
    const entry = this.#entries.get(key);
    if (entry === undefined) return undefined;

    if (this.#clock.now() - entry.storedAt > this.#options.ttlMs) {
      this.#entries.delete(key);
      return undefined;
    }

    return entry.value;
  }

  async remember(key: string, value: T): Promise<void> {
    // Insertion-ordered eviction rather than true LRU. An idempotency key is
    // read at most once in practice, so recency of *use* carries no information
    // that recency of *arrival* does not, and the bookkeeping is not worth it.
    if (this.#entries.size >= this.#options.maxEntries) {
      const oldest = this.#entries.keys().next();
      if (!oldest.done) this.#entries.delete(oldest.value);
    }

    this.#entries.set(key, { value, storedAt: this.#clock.now() });
  }

  /** Test and shutdown affordance. */
  clear(): void {
    this.#entries.clear();
  }

  get size(): number {
    return this.#entries.size;
  }
}
