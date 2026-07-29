import type { MemoryId } from '@nexa/shared';

/**
 * The specialised memory systems. Nexa does not have "a" memory.
 *
 * - `episodic`   — what happened, and when
 * - `semantic`   — what is true, independent of time
 * - `procedural` — how something is done
 * - `relational` — what the relationship is like
 * - `reflective` — an insight derived from other memories, not observed directly
 */
export type MemoryType =
  | 'episodic'
  | 'semantic'
  | 'procedural'
  | 'relational'
  | 'reflective';

export type MemorySource = 'conversation' | 'observation' | 'reflection' | 'user_stated';

export interface Memory {
  readonly id: MemoryId;
  readonly type: MemoryType;
  /** The memory in natural language. What actually enters a prompt. */
  readonly content: string;
  /** ISO 8601 UTC. When the memory was formed, not when it was last read. */
  readonly createdAt: string;
  /** 0–1. Drives retention, retrieval weight, and reflection eligibility. */
  readonly importance: number;
  /** 0–1. How sure the companion is that this is true. Inferences start low. */
  readonly confidence: number;
  /** Emotional charge, -1 (distressing) to 1 (joyful). Salience, not sentiment analysis. */
  readonly valence: number;
  readonly source: MemorySource;
  readonly tags: readonly string[];
  /** Ids of memories this one connects to. The knowledge graph's edges. */
  readonly relatedTo: readonly MemoryId[];
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
  /** Combined relevance, 0–1. */
  readonly score: number;
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

/** A candidate memory produced by a turn, before importance scoring and persistence. */
export interface MemoryCandidate {
  readonly content: string;
  readonly type: MemoryType;
  readonly source: MemorySource;
  readonly tags: readonly string[];
}
