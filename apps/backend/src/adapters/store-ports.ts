import type { CompanionId, UserId } from '@nexa/shared';
import type {
  FormationDecision,
  Insight,
  InsightDecision,
  Memory,
  Relationship,
  Timestamp,
} from '@nexa/models';

/**
 * What a store must be able to do, independent of where it keeps things.
 *
 * These are deliberately *not* Core ports. Core declares `MemoryWritePort` and
 * `MemoryRetrievalPort` — what the turn needs — and knows nothing about a store.
 * These interfaces sit one layer down, between the composition root's adapters
 * and whatever holds the rows, which is the seam a durable implementation slots
 * into without Core, the engines, or any client noticing.
 *
 * Every method takes `(companionId, userId)` and there is no overload that
 * omits either. That is the whole point: a store method that could be called
 * without an owner is a query that can forget to filter by one, and that is
 * precisely the leak Step 1 closed. The type system is doing the remembering.
 *
 * Everything is async even where the in-memory implementation answers
 * instantly. A store that reaches a database cannot be synchronous, and having
 * the interface admit that up front is what stops the durable implementation
 * from being a rewrite of every caller.
 */

/** Candidates handed to retrieval, and whether the set was cut short. */
export interface CandidateSet {
  readonly memories: readonly Memory[];
  readonly truncated: boolean;
}

/**
 * A semantic neighbour and the vector that made it one.
 *
 * The vector travels with the memory because ranking needs it. The database
 * orders by distance, but `@nexa/retrieval` scores `semantic` as one weighted
 * signal among five — it needs the numbers, not just the ordering, and it is
 * pure, so it cannot fetch them itself.
 */
export interface SemanticNeighbour {
  readonly memory: Memory;
  readonly vector: readonly number[];
}

export interface MemoryStore {
  /** Everything held for this owner. Used by formation to compare against. */
  all(companionId: CompanionId, userId: UserId): Promise<readonly Memory[]>;

  /**
   * Stage one of retrieval: a plausible set for `@nexa/retrieval` to rank.
   *
   * The store selects, the engine ranks. With no index behind it the selection
   * is "the most recent N"; a vector query replaces this method's body and
   * nothing above it moves.
   */
  candidates(companionId: CompanionId, userId: UserId): Promise<CandidateSet>;

  /**
   * Owner-scoped semantic candidates, nearest first.
   *
   * Separate from {@link candidates} rather than replacing it. Recency and
   * similarity answer different questions — a memory from this morning that
   * shares no vocabulary with the query is still context, and a query
   * embedding will never surface it. The caller unions the two.
   *
   * Returns nothing when the store has no vector search, which is what lets
   * the in-memory implementation satisfy this interface honestly rather than
   * pretending to rank by meaning.
   */
  similar(
    companionId: CompanionId,
    userId: UserId,
    query: readonly number[],
    model: string,
    limit: number,
  ): Promise<readonly SemanticNeighbour[]>;

  /**
   * Attaches a vector to a memory already stored.
   *
   * Scoped by owner like every other method: the backfill addresses rows by
   * id, and an update that trusted the id alone would be the one statement in
   * this interface that could cross the boundary.
   */
  attachEmbedding(
    companionId: CompanionId,
    userId: UserId,
    memoryId: string,
    vector: readonly number[],
    reference: { model: string; dimensions: number; vectorId: string; embeddedAt: Timestamp },
  ): Promise<void>;

  /** Memories with no vector for this model. The backfill's work queue. */
  awaitingEmbedding(model: string, limit: number): Promise<readonly Memory[]>;

  /** Applies a formation decision. Never makes one. */
  apply(
    companionId: CompanionId,
    userId: UserId,
    decision: FormationDecision,
    at: Timestamp,
  ): Promise<Memory | null>;
}

export interface InsightStore {
  all(companionId: CompanionId, userId: UserId): Promise<readonly Insight[]>;
  /** Live insights only. Retired and superseded ones stay readable as history. */
  active(companionId: CompanionId, userId: UserId): Promise<readonly Insight[]>;
  apply(
    companionId: CompanionId,
    userId: UserId,
    decisions: readonly InsightDecision[],
  ): Promise<readonly Insight[]>;
}

export interface RelationshipStore {
  /** Creates the record on first contact rather than returning null forever. */
  current(
    companionId: CompanionId,
    userId: UserId,
    at: Timestamp,
  ): Promise<Relationship>;
  save(relationship: Relationship): Promise<void>;
}
