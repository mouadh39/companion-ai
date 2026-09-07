import type { Pool } from 'pg';
import type { CompanionId, UserId } from '@nexa/shared';
import type {
  ConversationTurn,
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
import type { WorkingMemoryPort } from '@nexa/core';
import type {
  CandidateSet,
  SemanticNeighbour,
  InsightStore,
  MemoryStore,
  RelationshipStore,
} from '../store-ports.js';
import type { IdSource } from '../stores.js';
import { randomIds } from '../stores.js';
import {
  insightValues,
  isoRequired,
  memoryValues,
  relationshipValues,
  toInsight,
  toMemory,
  toRelationship,
} from './rows.js';

/**
 * The durable stores.
 *
 * Same interfaces, same decisions, different place to keep the rows. Every
 * engine rule still lives in `@nexa/memory`, `@nexa/reflection` and
 * `@nexa/relationship` — these apply decisions those engines already made, and
 * a store that scored a memory would be a second, untested copy of an engine.
 *
 * **Every statement is parameterised and every statement filters on both
 * `companion_id` and `user_id`.** There is no code path here that reads a row
 * without an owner, which is the property the schema's indexes assume and the
 * property the cross-user leak violated.
 */

/**
 * A vector as pgvector's text input form.
 *
 * Passed as a parameter and cast in SQL rather than interpolated, so the values
 * travel through the driver like every other bind. Building this string into
 * the statement would be the one place in the file where a number reached the
 * planner as text the driver never saw.
 */
const toVectorLiteral = (vector: readonly number[]): string => `[${vector.join(',')}]`;

/** The same form, read back. pgvector renders `vector` as `[a,b,c]`. */
const fromVectorLiteral = (text: string | null): readonly number[] => {
  if (text === null || text.length < 2) return [];
  return text.slice(1, -1).split(',').map(Number);
};

const MEMORY_COLUMNS =
  'id, companion_id, user_id, type, subject, content, created_at, importance, ' +
  'confidence, valence, source, expires_at, reinforcement_count, last_reinforced_at, ' +
  'tags, related_to, embedding_vector_id, embedding_model, embedding_dimensions, ' +
  'embedding_at, metadata';

const MEMORY_PLACEHOLDERS = Array.from({ length: 21 }, (_, i) => `$${i + 1}`).join(', ');

export class PgMemoryStore implements MemoryStore {
  readonly #pool: Pool;
  readonly #ids: IdSource;
  readonly #candidateLimit: number;

  constructor(pool: Pool, ids: IdSource = randomIds, candidateLimit = 200) {
    this.#pool = pool;
    this.#ids = ids;
    this.#candidateLimit = candidateLimit;
  }

  async all(companionId: CompanionId, userId: UserId): Promise<readonly Memory[]> {
    const { rows } = await this.#pool.query<Record<string, unknown>>(
      `select ${MEMORY_COLUMNS} from memories
        where companion_id = $1 and user_id = $2
        order by created_at asc`,
      [companionId, userId],
    );
    return rows.map(toMemory);
  }

  async candidates(companionId: CompanionId, userId: UserId): Promise<CandidateSet> {
    // One extra row, purely to detect truncation without a second count query.
    const { rows } = await this.#pool.query<Record<string, unknown>>(
      `select ${MEMORY_COLUMNS} from memories
        where companion_id = $1 and user_id = $2
        order by created_at desc
        limit $3`,
      [companionId, userId, this.#candidateLimit + 1],
    );

    const truncated = rows.length > this.#candidateLimit;
    const kept = truncated ? rows.slice(0, this.#candidateLimit) : rows;

    // Oldest first, matching what the in-memory store hands to retrieval.
    return { memories: kept.map(toMemory).reverse(), truncated };
  }

  /**
   * Owner-scoped approximate nearest neighbours.
   *
   * The ownership predicate sits in the *same statement* as the ANN order-by,
   * never as a filter applied to its output. That distinction is the whole
   * security property: post-filtering lets another user's vectors occupy the
   * top k first, so the query returns fewer of this user's rows — or none —
   * while still looking like it worked.
   *
   * `hnsw.iterative_scan` is what makes the filtered search return a full set
   * rather than whatever survived the first k. pgvector 0.8 added it precisely
   * for this shape of query.
   *
   * `embedding_model` is compared too. Cosine between vectors from different
   * models is an ordinary number that means nothing, and a half-migrated store
   * is the normal case during a model change rather than an exotic one.
   */
  async similar(
    companionId: CompanionId,
    userId: UserId,
    query: readonly number[],
    model: string,
    limit: number,
  ): Promise<readonly SemanticNeighbour[]> {
    if (query.length === 0 || limit <= 0) return [];

    const client = await this.#pool.connect();
    try {
      await client.query("set local hnsw.iterative_scan = 'relaxed_order'");
      const { rows } = await client.query<Record<string, unknown>>(
        `select ${MEMORY_COLUMNS}, embedding::text as embedding_text from memories
          where companion_id = $1
            and user_id = $2
            and embedding is not null
            and embedding_model = $3
          order by embedding <=> $4::vector
          limit $5`,
        [companionId, userId, model, toVectorLiteral(query), limit],
      );
      return rows.map((row) => ({
        memory: toMemory(row),
        vector: fromVectorLiteral(row['embedding_text'] as string | null),
      }));
    } finally {
      client.release();
    }
  }

  async attachEmbedding(
    companionId: CompanionId,
    userId: UserId,
    memoryId: string,
    vector: readonly number[],
    reference: { model: string; dimensions: number; vectorId: string; embeddedAt: Timestamp },
  ): Promise<void> {
    await this.#pool.query(
      `update memories
          set embedding = $1::vector,
              embedding_vector_id = $2,
              embedding_model = $3,
              embedding_dimensions = $4,
              embedding_at = $5
        where id = $6 and companion_id = $7 and user_id = $8`,
      [
        toVectorLiteral(vector),
        reference.vectorId,
        reference.model,
        reference.dimensions,
        reference.embeddedAt,
        memoryId,
        companionId,
        userId,
      ],
    );
  }

  /**
   * The backfill's work queue.
   *
   * Deliberately *not* owner-scoped, and the only method here that is not: the
   * backfill embeds across every owner. It is safe because it never compares or
   * ranks — it reads a row and writes a vector back to that same row by id.
   * Each result carries its own `companionId`/`userId`, which the caller hands
   * straight back to `attachEmbedding`, so the boundary is preserved on write.
   */
  async awaitingEmbedding(model: string, limit: number): Promise<readonly Memory[]> {
    const { rows } = await this.#pool.query<Record<string, unknown>>(
      `select ${MEMORY_COLUMNS} from memories
        where embedding is null or embedding_model is distinct from $1
        order by created_at asc
        limit $2`,
      [model, limit],
    );
    return rows.map(toMemory);
  }

  async apply(
    companionId: CompanionId,
    userId: UserId,
    decision: FormationDecision,
    at: Timestamp,
  ): Promise<Memory | null> {
    switch (decision.outcome) {
      case 'store': {
        const stored = this.#materialise(decision.draft, companionId, userId);
        await this.#insert(stored, companionId);
        return stored;
      }

      case 'reinforce': {
        const target = await this.#byId(companionId, userId, decision.targetId);
        if (target === null) return null;

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

        await this.#pool.query(
          `update memories
              set confidence = $1, importance = $2, expires_at = $3,
                  reinforcement_count = $4, last_reinforced_at = $5
            where id = $6 and companion_id = $7 and user_id = $8`,
          [
            reinforced.confidence,
            reinforced.importance,
            reinforced.expiresAt,
            reinforced.reinforcementCount,
            reinforced.lastReinforcedAt,
            reinforced.id,
            companionId,
            userId,
          ],
        );
        return reinforced;
      }

      case 'supersede': {
        const stored = this.#materialise(decision.draft, companionId, userId);
        // The superseded memory is kept, not deleted — expiry is a reason to
        // stop retrieving, never an erasure.
        await this.#pool.query(
          `update memories set expires_at = $1
            where id = $2 and companion_id = $3 and user_id = $4`,
          [at, decision.targetId, companionId, userId],
        );
        await this.#insert(stored, companionId);
        return stored;
      }

      case 'reject':
        return null;
    }
  }

  async #byId(
    companionId: CompanionId,
    userId: UserId,
    id: Memory['id'],
  ): Promise<Memory | null> {
    const { rows } = await this.#pool.query<Record<string, unknown>>(
      `select ${MEMORY_COLUMNS} from memories
        where id = $1 and companion_id = $2 and user_id = $3`,
      [id, companionId, userId],
    );
    return rows[0] === undefined ? null : toMemory(rows[0]);
  }

  async #insert(memory: Memory, companionId: CompanionId): Promise<void> {
    await this.#pool.query(
      `insert into memories (${MEMORY_COLUMNS}) values (${MEMORY_PLACEHOLDERS})
       on conflict (id) do nothing`,
      [...memoryValues(memory, companionId)],
    );
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
      embedding: null,
      metadata: { ...draft.metadata },
    };
  }
}

const INSIGHT_COLUMNS =
  'id, companion_id, user_id, key, kind, topic_key, topic, polarity, statement, ' +
  'status, certainty, confidence, evidence_confidence, stability, created_at, ' +
  'updated_at, last_supported_at, expires_at, revision, supersedes, superseded_by, ' +
  'supporting, opposing, history, retirement, provenance';

const INSIGHT_PLACEHOLDERS = Array.from({ length: 26 }, (_, i) => `$${i + 1}`).join(', ');

const INSIGHT_UPDATES = INSIGHT_COLUMNS.split(', ')
  .filter((column) => column !== 'id')
  .map((column) => `${column} = excluded.${column}`)
  .join(', ');

const LIVE_STATUSES: readonly string[] = ['active', 'contested'];

export class PgInsightStore implements InsightStore {
  readonly #pool: Pool;
  readonly #ids: IdSource;

  constructor(pool: Pool, ids: IdSource = randomIds) {
    this.#pool = pool;
    this.#ids = ids;
  }

  async all(companionId: CompanionId, userId: UserId): Promise<readonly Insight[]> {
    const { rows } = await this.#pool.query<Record<string, unknown>>(
      `select ${INSIGHT_COLUMNS} from insights
        where companion_id = $1 and user_id = $2
        order by created_at asc`,
      [companionId, userId],
    );
    return rows.map(toInsight);
  }

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

    const client = await this.#pool.connect();
    try {
      await client.query('begin');

      // Retired and superseded rows are written first. A supersession flips one
      // insight out of `active` and another in, and the partial unique index on
      // (companion_id, user_id, key) over live rows would reject the pair if the
      // incoming live row landed before the outgoing one stepped aside.
      const ordered = [
        ...next.filter((insight) => !LIVE_STATUSES.includes(insight.status)),
        ...next.filter((insight) => LIVE_STATUSES.includes(insight.status)),
      ];

      for (const insight of ordered) {
        await client.query(
          `insert into insights (${INSIGHT_COLUMNS}) values (${INSIGHT_PLACEHOLDERS})
           on conflict (id) do update set ${INSIGHT_UPDATES}`,
          [...insightValues(insight)],
        );
      }

      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }

    return next;
  }
}

const RELATIONSHIP_COLUMNS =
  'id, companion_id, user_id, type, dimensions, interaction_count, first_met_at, ' +
  'last_interaction_at, inferred_style, boundaries, counters, metadata';

const RELATIONSHIP_PLACEHOLDERS = Array.from({ length: 12 }, (_, i) => `$${i + 1}`).join(', ');

const RELATIONSHIP_UPDATES = RELATIONSHIP_COLUMNS.split(', ')
  .filter((column) => column !== 'id' && column !== 'companion_id' && column !== 'user_id')
  .map((column) => `${column} = excluded.${column}`)
  .join(', ');

export class PgRelationshipStore implements RelationshipStore {
  readonly #pool: Pool;
  readonly #ids: IdSource;

  constructor(pool: Pool, ids: IdSource = randomIds) {
    this.#pool = pool;
    this.#ids = ids;
  }

  async current(
    companionId: CompanionId,
    userId: UserId,
    at: Timestamp,
  ): Promise<Relationship> {
    const { rows } = await this.#pool.query<Record<string, unknown>>(
      `select ${RELATIONSHIP_COLUMNS} from relationships
        where companion_id = $1 and user_id = $2`,
      [companionId, userId],
    );
    if (rows[0] !== undefined) return toRelationship(rows[0]);

    // A companion that has spoken to someone has a relationship with them,
    // however new. `@nexa/relationship` already models "we have just met" as a
    // stage rather than as an absence.
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
    await this.save(created);
    return created;
  }

  async save(relationship: Relationship): Promise<void> {
    await this.#pool.query(
      `insert into relationships (${RELATIONSHIP_COLUMNS})
       values (${RELATIONSHIP_PLACEHOLDERS})
       on conflict (companion_id, user_id) do update set ${RELATIONSHIP_UPDATES}`,
      [...relationshipValues(relationship)],
    );
  }
}

/**
 * Durable working memory.
 *
 * The 50-turn cap is now a `limit` on read rather than a splice on write. Older
 * turns stay on disk — they cost nothing, and throwing away the transcript to
 * enforce a prompt-sized window would be the storage layer making a decision
 * that belongs to assembly.
 */
export class PgWorkingMemory implements WorkingMemoryPort {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async recent(
    companionId: CompanionId,
    userId: UserId,
    limit: number,
  ): Promise<readonly ConversationTurn[]> {
    const { rows } = await this.#pool.query<Record<string, unknown>>(
      `select role, content, at from conversation_turns
        where companion_id = $1 and user_id = $2
        order by id desc
        limit $3`,
      [companionId, userId, limit],
    );

    return rows
      .map((row) => ({
        role: row['role'] as ConversationTurn['role'],
        content: row['content'] as string,
        at: isoRequired(row['at'] as Date),
      }))
      .reverse();
  }

  async append(
    companionId: CompanionId,
    userId: UserId,
    turn: ConversationTurn,
  ): Promise<void> {
    await this.#pool.query(
      `insert into conversation_turns (companion_id, user_id, role, content, at)
       values ($1, $2, $3, $4, $5)`,
      [companionId, userId, turn.role, turn.content, turn.at],
    );
  }
}
