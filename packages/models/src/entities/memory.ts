import type { MemoryId, UserId } from '@nexa/shared';
import type { MemorySource, MemoryType } from '../enums/memory.js';
import type { ConfidenceScore, ImportanceScore, Valence } from '../value-objects/score.js';
import type { Timestamp } from '../value-objects/timestamp.js';
import type { EmbeddingReference } from '../value-objects/embedding-reference.js';
import type { Metadata } from '../value-objects/metadata.js';

export type { MemoryType, MemorySource } from '../enums/memory.js';

/**
 * One thing the companion knows.
 *
 * Sized to be cheap. Everything unbounded lives behind a reference — the vector
 * in the store via `embedding`, related memories as ids — because this object
 * is read on every turn and the system is meant to hold years of them. A
 * `Memory` that carried its own embedding would make context assembly's cost
 * proportional to the size of the vector rather than to the number of memories.
 */
export interface Memory {
  readonly id: MemoryId;
  /**
   * The owner. Every memory is scoped to a user — the privacy story in
   * `18_Memory_Architecture.md` rests on this being non-optional, and a
   * nullable owner is how cross-tenant leaks happen at the query layer.
   */
  readonly userId: UserId;
  readonly type: MemoryType;
  /** The memory in natural language. What actually enters a prompt. */
  readonly content: string;
  /** When the memory was formed, not when it was last read. */
  readonly createdAt: Timestamp;
  /** Drives retention, retrieval weight, and reflection eligibility. */
  readonly importance: ImportanceScore;
  /** How sure the companion is that this is true. Inferences start low. */
  readonly confidence: ConfidenceScore;
  /** Emotional charge. Salience, not sentiment analysis. */
  readonly valence: Valence;
  readonly source: MemorySource;
  readonly tags: readonly string[];
  /** Ids of memories this one connects to. The knowledge graph's edges. */
  readonly relatedTo: readonly MemoryId[];
  /**
   * Null until the memory has been embedded.
   *
   * Embedding happens in the worker, after the turn — so a memory exists and is
   * readable before it is searchable. Modelling that gap explicitly is what
   * stops retrieval from assuming a vector that is not there yet.
   */
  readonly embedding: EmbeddingReference | null;
  readonly metadata: Metadata;
}

/**
 * A memory returned by retrieval, carrying *why* it was returned.
 *
 * The per-signal breakdown is not diagnostics — it is the substrate for
 * explainability. "Why did you bring that up?" is answerable only if the
 * ranking survived the retrieval call.
 */
export interface RetrievedMemory {
  readonly memory: Memory;
  /** Combined relevance. */
  readonly score: ConfidenceScore;
  readonly signals: RetrievalSignals;
}

/**
 * The independent signals feeding the ranking.
 *
 * Each is scored separately so no single one can dominate — a requirement
 * stated in `docs/memory/18_Memory_Architecture.md` and one that only holds if
 * the parts stay visible.
 */
export interface RetrievalSignals {
  readonly semantic: number;
  readonly recency: number;
  readonly importance: number;
  readonly goalRelevance: number;
  readonly emotionalSalience: number;
}

/**
 * A candidate memory produced by a turn, before importance scoring and
 * persistence.
 *
 * Has no id, no timestamp and no importance, and the absences are the point:
 * all three are assigned by the worker that commits it. A candidate that
 * already carried an id would be indistinguishable from a stored memory, and
 * the turn would be doing persistence work on the critical path.
 */
export interface MemoryCandidate {
  readonly content: string;
  readonly type: MemoryType;
  readonly source: MemorySource;
  readonly tags: readonly string[];
}
