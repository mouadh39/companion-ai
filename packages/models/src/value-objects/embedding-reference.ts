import type { Timestamp } from './timestamp.js';

/**
 * A *pointer* to a vector, never the vector itself.
 *
 * This is the single most important scaling decision in the domain vocabulary.
 * A 1536-dimension embedding is ~6 KB as floats and considerably more as JSON.
 * Inlining it on `Memory` would mean every memory read, every event carrying a
 * memory, and every context assembly moves kilobytes of numbers that only the
 * vector store can use. At millions of users and years of history that is the
 * difference between a working system and one that spends its life serialising
 * arrays no reader looks at.
 *
 * So the vector lives in the vector store and the domain holds a reference.
 * `18_Memory_Architecture.md` requires retrieval to stay fast as history grows;
 * this is what makes the domain object's size independent of that growth.
 */
export interface EmbeddingReference {
  /**
   * Identifier within the vector store. Not a `MemoryId` — one memory may be
   * embedded more than once, and re-embedding must not reuse the old vector.
   */
  readonly vectorId: string;

  /**
   * The embedding model that produced it, e.g. `voyage-3`.
   *
   * Stored because vectors from different models are not comparable. Without
   * it, a model upgrade silently corrupts every similarity search: the
   * arithmetic still succeeds and the results become meaningless, which is far
   * worse than an error. This field is what makes a backfill detectable.
   */
  readonly model: string;

  /** Dimensionality. A cheap guard against comparing incompatible vectors. */
  readonly dimensions: number;

  /** When the vector was produced, so staleness after a re-embed is visible. */
  readonly embeddedAt: Timestamp;
}

/**
 * True when two references can be meaningfully compared.
 *
 * Cosine similarity between vectors from different models returns a number
 * rather than an error, and that number means nothing. Checking is cheap;
 * discovering the mistake through months of subtly wrong retrieval is not.
 */
export const isComparable = (a: EmbeddingReference, b: EmbeddingReference): boolean =>
  a.model === b.model && a.dimensions === b.dimensions;
