import type { CompanionId, InsightId, MemoryId, RelationshipId, UserId } from '@nexa/shared';
import { newInsightId, newMemoryId, newRelationshipId } from '@nexa/shared';
import type {
  FormationDecision,
  Insight,
  InsightDecision,
  InsightDraft,
  Memory,
  MemoryDraft,
  Relationship,
  Timestamp,
} from '@nexa/models';
import { confidence, initialCounters, initialRelationshipDimensions } from '@nexa/models';
import { applyDecisions } from '@nexa/reflection';
import type {
  CandidateSet,
  SemanticNeighbour,
  InsightStore,
  MemoryStore,
  RelationshipStore,
} from './store-ports.js';

/**
 * In-memory stores, so the engines have something real to read and write.
 *
 * Milestone-1 adapters in the same sense as `InMemoryWorkingMemory`: they
 * implement a real seam with a shallow body, and they live in the composition
 * root because that is what they are — wiring, not capability. A durable store
 * replaces each of these and nothing else in the system moves.
 *
 * What they deliberately do **not** do is decide anything. The formation rules
 * live in `@nexa/memory`, the reflection rules in `@nexa/reflection`, the
 * progression rules in `@nexa/relationship`. These apply decisions those engines
 * already made. A store that scored a memory would be a second, untested copy of
 * an engine.
 */

/**
 * Where identifiers come from.
 *
 * Injected rather than called directly, because `newMemoryId()` is randomness
 * and the replay harness needs a run to be reproducible end to end. Production
 * passes the real generators; the harness passes a counter. Nothing else in the
 * system changes, and no engine is aware either exists — every engine already
 * refuses to mint an id for exactly this reason.
 */
export interface IdSource {
  memoryId(): MemoryId;
  insightId(): InsightId;
  relationshipId(): RelationshipId;
}

export const randomIds: IdSource = {
  memoryId: newMemoryId,
  insightId: newInsightId,
  relationshipId: newRelationshipId,
};

/** Deterministic identifiers, for replay. Same sequence every run. */
export const countingIds = (prefix = 'fixed'): IdSource => {
  let memories = 0;
  let insights = 0;
  let relationships = 0;
  return {
    memoryId: () => `${prefix}-mem-${++memories}` as MemoryId,
    insightId: () => `${prefix}-ins-${++insights}` as InsightId,
    relationshipId: () => `${prefix}-rel-${++relationships}` as RelationshipId,
  };
};

export type { CandidateSet } from './store-ports.js';

/**
 * Long-term memory, per companion.
 *
 * `candidates` is the first stage of the two-stage retrieval contract: this
 * store selects a plausible set and `@nexa/retrieval` ranks it. With no index
 * behind it the selection is "the most recent `limit`", which is honest for an
 * in-memory store and is exactly the seam a vector search slots into.
 */
/**
 * The isolation boundary every per-user store shares.
 *
 * Length-prefixed rather than joined on a bare separator: ids arrive from
 * clients through `trustExternalId` and are not guaranteed to exclude any
 * character, so `a:b` + `c` and `a` + `b:c` would otherwise land in one
 * bucket -- the exact leak this key exists to prevent.
 */
const scopeKey = (companionId: CompanionId, userId: UserId): string =>
  `${companionId.length}:${companionId}:${userId}`;

export class InMemoryMemoryStore implements MemoryStore {
  readonly #byOwner = new Map<string, Memory[]>();
  readonly #ids: IdSource;
  readonly #candidateLimit: number;

  constructor(ids: IdSource = randomIds, candidateLimit = 200) {
    this.#ids = ids;
    this.#candidateLimit = candidateLimit;
  }

  async all(companionId: CompanionId, userId: UserId): Promise<readonly Memory[]> {
    return this.#byOwner.get(scopeKey(companionId, userId)) ?? [];
  }

  async candidates(companionId: CompanionId, userId: UserId): Promise<CandidateSet> {
    const held = await this.all(companionId, userId);
    if (held.length <= this.#candidateLimit) return { memories: held, truncated: false };

    return {
      memories: held.slice(-this.#candidateLimit),
      // Reported rather than swallowed. Retrieval turns this into a recorded
      // degradation, so a thin result caused by a truncated candidate set is
      // distinguishable from one caused by a sparse history.
      truncated: true,
    };
  }

  /**
   * Applies a formation decision. Never makes one.
   *
   * Returns the memory that resulted, or null for a rejection — which the caller
   * needs in order to emit the right event, and which is the only reason this
   * returns anything at all.
   */
  /**
   * No vector search here, and it says so rather than approximating one.
   *
   * This store exists so the pipeline runs with no database. Scanning every
   * memory and computing cosines in JavaScript would make the in-memory path
   * behave differently from the durable one under load, and would let a test
   * pass here that fails against Postgres. Returning nothing means retrieval
   * falls back to the recency set and records `semantic_unavailable`, which is
   * the honest description of a store with no index.
   */
  async similar(): Promise<readonly SemanticNeighbour[]> {
    return [];
  }

  async attachEmbedding(
    companionId: CompanionId,
    userId: UserId,
    memoryId: string,
    _vector: readonly number[],
    reference: { model: string; dimensions: number; vectorId: string; embeddedAt: Timestamp },
  ): Promise<void> {
    const key = scopeKey(companionId, userId);
    const held = this.#byOwner.get(key);
    if (held === undefined) return;

    const index = held.findIndex((memory) => memory.id === memoryId);
    const target = held[index];
    if (target === undefined) return;

    held[index] = {
      ...target,
      embedding: {
        vectorId: reference.vectorId,
        model: reference.model,
        dimensions: reference.dimensions,
        embeddedAt: reference.embeddedAt,
      },
    };
    this.#byOwner.set(key, held);
  }

  async awaitingEmbedding(model: string, limit: number): Promise<readonly Memory[]> {
    const pending: Memory[] = [];
    for (const held of this.#byOwner.values()) {
      for (const memory of held) {
        if (memory.embedding === null || memory.embedding.model !== model) pending.push(memory);
        if (pending.length >= limit) return pending;
      }
    }
    return pending;
  }

  async apply(
    companionId: CompanionId,
    userId: UserId,
    decision: FormationDecision,
    at: Timestamp,
  ): Promise<Memory | null> {
    const key = scopeKey(companionId, userId);
    const held = this.#byOwner.get(key) ?? [];

    switch (decision.outcome) {
      case 'store': {
        const stored = this.#materialise(decision.draft, companionId, userId);
        held.push(stored);
        this.#byOwner.set(key, held);
        return stored;
      }

      case 'reinforce': {
        const index = held.findIndex((memory) => memory.id === decision.targetId);
        const target = held[index];
        if (target === undefined) return null;

        const reinforced: Memory = {
          ...target,
          confidence: confidence(
            Math.min(1, target.confidence + decision.reinforcement.confidenceDelta),
          ),
          importance: Math.min(
            1,
            target.importance + decision.reinforcement.importanceDelta,
          ) as Memory['importance'],
          expiresAt: decision.reinforcement.expiresAt,
          reinforcementCount: target.reinforcementCount + 1,
          lastReinforcedAt: decision.reinforcement.reinforcedAt,
        };
        held[index] = reinforced;
        this.#byOwner.set(key, held);
        return reinforced;
      }

      case 'supersede': {
        const stored = this.#materialise(decision.draft, companionId, userId);
        // The superseded memory is kept, not deleted. `18_Memory_Architecture.md`
        // makes forgetting a reason to stop retrieving rather than an erasure,
        // and history that rewrote itself would answer "what did you used to
        // think?" with a lie.
        const index = held.findIndex((memory) => memory.id === decision.targetId);
        const target = held[index];
        if (target !== undefined) {
          held[index] = { ...target, expiresAt: at };
        }
        held.push(stored);
        this.#byOwner.set(key, held);
        return stored;
      }

      case 'reject':
        return null;
    }
  }

  #materialise(draft: MemoryDraft, companionId: CompanionId, userId: UserId): Memory {
    return {
      id: this.#ids.memoryId(),
      userId,
      companionId,
      type: draft.type,
      subject: draft.subject,
      content: draft.content,
      createdAt: draft.createdAt,
      importance: draft.importance,
      confidence: draft.confidence,
      valence: draft.valence,
      source: draft.source,
      expiresAt: draft.expiresAt,
      reinforcementCount: 0,
      lastReinforcedAt: null,
      tags: draft.tags,
      relatedTo: draft.relatedTo,
      // Null until the embedding worker runs. Modelling the gap is what stops
      // retrieval assuming a vector that is not there yet.
      embedding: null,
      metadata: { ...draft.metadata },
    };
  }
}

/** Insights, per companion and user. Written only by the reflection worker. */
export class InMemoryInsightStore implements InsightStore {
  readonly #byOwner = new Map<string, readonly Insight[]>();
  readonly #ids: IdSource;

  constructor(ids: IdSource = randomIds) {
    this.#ids = ids;
  }

  async all(companionId: CompanionId, userId: UserId): Promise<readonly Insight[]> {
    return this.#byOwner.get(scopeKey(companionId, userId)) ?? [];
  }

  /** Live insights only. Retired and superseded ones stay readable as history. */
  async active(companionId: CompanionId, userId: UserId): Promise<readonly Insight[]> {
    return (await this.all(companionId, userId)).filter(
      (insight) => insight.status === 'active' || insight.status === 'contested',
    );
  }

  async apply(
    companionId: CompanionId,
    userId: UserId,
    decisions: readonly InsightDecision[],
  ): Promise<readonly Insight[]> {
    const next = applyDecisions(
      await this.all(companionId, userId),
      decisions,
      userId,
      companionId,
      (_draft: InsightDraft) => this.#ids.insightId(),
    );
    this.#byOwner.set(scopeKey(companionId, userId), next);
    return next;
  }
}

/**
 * The relationship record, per companion and user.
 *
 * Creates one on first contact rather than returning null forever. A companion
 * that has spoken to someone has a relationship with them, however new — and
 * `@nexa/relationship` already models "we have just met" as a stage rather than
 * as an absence.
 */
export class InMemoryRelationshipStore implements RelationshipStore {
  readonly #byPair = new Map<string, Relationship>();
  readonly #ids: IdSource;

  constructor(ids: IdSource = randomIds) {
    this.#ids = ids;
  }

  async current(
    companionId: CompanionId,
    userId: UserId,
    at: Timestamp,
  ): Promise<Relationship> {
    const key = `${companionId}:${userId}`;
    const held = this.#byPair.get(key);
    if (held !== undefined) return held;

    const created: Relationship = {
      id: this.#ids.relationshipId(),
      userId,
      companionId,
      type: 'new',
      dimensions: initialRelationshipDimensions(),
      interactionCount: 0,
      firstMetAt: at,
      lastInteractionAt: at,
      inferredStyle: null,
      boundaries: [],
      counters: initialCounters(),
      metadata: {},
    };
    this.#byPair.set(key, created);
    return created;
  }

  async save(relationship: Relationship): Promise<void> {
    this.#byPair.set(`${relationship.companionId}:${relationship.userId}`, relationship);
  }
}
