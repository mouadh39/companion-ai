import type { CompanionId, UserId } from '@nexa/shared';
import type {
  ConversationTurn,
  Insight,
  Memory,
  MemoryCandidate,
  Relationship,
  RetrievedMemory,
  Timestamp,
} from '@nexa/models';
import { timestamp } from '@nexa/models';
import type { Clock } from '@nexa/shared';
import type {
  DecisionAdviceRequest,
  DecisionAdvisorPort,
  EmbeddingPort,
  MemoryRetrievalPort,
  MemoryWritePort,
  PortOptions,
  RelationshipPort,
  RetrievalQuery,
  WorkingMemoryPort,
} from '@nexa/core';
import type { DecisionHint } from '@nexa/models';
import { currentIdentity } from '@nexa/identity';
import { decide } from '@nexa/memory';
import { plan, toDecisionHint } from '@nexa/planning';
import { deriveProfile } from '@nexa/relationship';
import { retrieve, toRetrievedMemories } from '@nexa/retrieval';
import type { SemanticIndex } from '@nexa/retrieval';
import type { TurnScratchpad } from './scratchpad.js';
import type {
  CandidateSet,
  InsightStore,
  MemoryStore,
  RelationshipStore,
  SemanticNeighbour,
} from './store-ports.js';

/**
 * The four remaining engines, behind the ports Core declares.
 *
 * Each is thin, and each is thin on purpose. An adapter that did real work would
 * be a capability hiding in the composition root, where it has no package, no
 * tests of its own and no README saying what it is. Every one of these maps a
 * port's request onto an engine's request, calls a pure function, and projects
 * the result back onto whatever Core asked for.
 *
 * `@nexa/core` names none of these packages, and none of them knows a turn
 * exists. They meet here, which is the only place permitted to know both sides.
 */

/**
 * Retrieval, behind `MemoryRetrievalPort`.
 *
 * Replaces `EmptyMemoryRetrieval`, which returned `[]` because there was no
 * store behind it — honest at the time, and now merely empty.
 *
 * ## Two stages, and this adapter is the seam between them
 *
 * `@nexa/retrieval` is explicitly the *second* stage: given a few hundred
 * plausible candidates, choose the dozen that matter. Candidate *generation*
 * belongs to the store, which is what `candidates()` is. With an in-memory store
 * that selection is "the most recent 200", and `truncated` reports when it cut
 * the list short — which retrieval turns into a recorded degradation rather than
 * an invisible one. A vector index slots in here and nothing else moves.
 *
 * ## It also fills in who the turn belongs to
 *
 * `RetrievalQuery` carries `companionId` and `userId`; `PerceptionPort` carries
 * neither. This is the first adapter in the turn that knows both, so it records
 * them for the commit stage. That coupling is stated rather than implied,
 * because it is the reason memory formation degrades when retrieval fails.
 */
export class RetrievalEngine implements MemoryRetrievalPort {
  readonly #memories: MemoryStore;
  readonly #insights: InsightStore;
  readonly #relationships: RelationshipStore;
  readonly #workingMemory: WorkingMemoryPort;
  readonly #scratchpad: TurnScratchpad;
  readonly #conversationTurns: number;
  readonly #embedder: EmbeddingPort | null;
  readonly #semanticLimit: number;

  constructor(deps: {
    readonly memories: MemoryStore;
    readonly insights: InsightStore;
    readonly relationships: RelationshipStore;
    readonly workingMemory: WorkingMemoryPort;
    readonly scratchpad: TurnScratchpad;
    readonly conversationTurns?: number;
    /** Absent means lexical-only retrieval, exactly as before Step 3. */
    readonly embedder?: EmbeddingPort | null;
    readonly semanticLimit?: number;
  }) {
    this.#memories = deps.memories;
    this.#insights = deps.insights;
    this.#relationships = deps.relationships;
    this.#workingMemory = deps.workingMemory;
    this.#scratchpad = deps.scratchpad;
    this.#conversationTurns = deps.conversationTurns ?? 6;
    this.#embedder = deps.embedder ?? null;
    this.#semanticLimit = deps.semanticLimit ?? 40;
  }

  async retrieve(
    query: RetrievalQuery,
    options: PortOptions,
  ): Promise<readonly RetrievedMemory[]> {
    const facts = this.#scratchpad.read(options.turnId);
    // Without perception there is no query to run. Returning empty is the same
    // answer `EmptyMemoryRetrieval` gave and is correct here for the same
    // reason: a fabricated memory is worse than none.
    if (facts === null) return [];

    this.#scratchpad.record(options.turnId, {
      companionId: query.companionId,
      userId: query.userId,
    });

    /*
     * Started together, awaited together.
     *
     * These five reads were sequential `await`s, which made the turn wait out
     * the sum of them — measured at 720ms warm — when nothing here consumes
     * anything another produces. They are started here and resolved below; the
     * pure `retrieve()` call at the bottom is what actually needs the values,
     * and it needs all of them, so the order they arrive in cannot matter.
     *
     * `#semanticNeighbours` is the one with an internal sequence — the query
     * vector, then the search that uses it — and it stays sequential inside
     * itself. It no longer waits on `candidates` to start, because it never
     * read the candidate set: only the union below does, which is arithmetic
     * performed once both have landed.
     */
    const candidatesInFlight = this.#memories.candidates(query.companionId, query.userId);
    const insightsInFlight = this.#insights.active(query.companionId, query.userId);
    const neighboursInFlight = this.#semanticNeighbours(query, facts.message, options);
    // Derived here rather than read from the scratchpad, so retrieval does not
    // depend on the relationship contributor having finished first. `deriveProfile`
    // is pure, so computing it twice in one turn costs arithmetic and cannot
    // disagree with itself.
    const relationshipInFlight = this.#relationships.current(
      query.companionId,
      query.userId,
      facts.at,
    );
    const conversationInFlight = this.#workingMemory.recent(
      query.companionId,
      query.userId,
      this.#conversationTurns,
      options,
    );

    /*
     * `allSettled` rather than `all`, for two reasons that both matter.
     *
     * `Promise.all` rejects with whichever promise failed *first in time*, so
     * the error a turn reports would depend on which query happened to be
     * slower. Sequential code always surfaced the earliest failure in source
     * order; rethrowing below in that same order keeps the diagnosis stable
     * rather than making it a race.
     *
     * And `all` leaves its siblings running unobserved: a second failure after
     * the first would surface as an unhandled rejection with no turn left to
     * attribute it to. Settling every one means each rejection is accounted
     * for, and only the one that would have been reported is rethrown.
     */
    const settled = await Promise.allSettled([
      candidatesInFlight,
      insightsInFlight,
      neighboursInFlight,
      relationshipInFlight,
      conversationInFlight,
    ]);

    for (const result of settled) {
      if (result.status === 'rejected') throw result.reason;
    }

    const [candidatesResult, insightsResult, neighboursResult, relationshipResult, conversationResult] =
      settled as readonly [
        PromiseFulfilledResult<CandidateSet>,
        PromiseFulfilledResult<readonly Insight[]>,
        PromiseFulfilledResult<SemanticNeighbourhood | null>,
        PromiseFulfilledResult<Relationship>,
        PromiseFulfilledResult<readonly ConversationTurn[]>,
      ];

    const candidates = candidatesResult.value;
    const insights = insightsResult.value;
    const conversation = conversationResult.value;

    // Recency and similarity answer different questions, so the sets are
    // unioned rather than swapped. Dropping the recency half would lose
    // anything this morning's conversation touched that the query happens to
    // share no vocabulary or meaning with.
    const semantic = this.#unionSemantic(candidates.memories, neighboursResult.value);

    const relationship = deriveProfile(relationshipResult.value, facts.at);

    const outcome = retrieve({
      at: facts.at,
      perception: facts.perception,
      message: facts.message,
      conversation,
      memories: semantic.memories,
      insights,
      goals: query.goals,
      relationship,
      identity: currentIdentity(),
      candidatesTruncated: candidates.truncated,
      semantic: semantic.index,
      // The context budget's own ceiling, honoured rather than re-decided.
      budget: {
        maxItems: query.maxResults,
        maxTokens: 4_000,
        maxPerClass: {},
        reserved: {},
      },
    });

    this.#scratchpad.record(options.turnId, { relationship, retrieval: outcome });

    return toRetrievedMemories(outcome);
  }

  /**
   * Query vector, semantic candidates, and the index that lets ranking use them.
   *
   * Three things can go wrong and none of them may fail the turn: there is no
   * embedder configured, the provider is unreachable, or the store has no
   * vector search. Each falls back to the recency set with `semantic: null`,
   * which `@nexa/retrieval` already handles by ranking on its other signals and
   * recording a `semantic_unavailable` degradation. A memory outage caused by an
   * embedding outage would be a far worse failure than a slightly worse ranking.
   */
  async #semanticNeighbours(
    query: RetrievalQuery,
    message: string,
    options: PortOptions,
  ): Promise<SemanticNeighbourhood | null> {
    const embedder = this.#embedder;
    if (embedder === null || message.trim() === '') return null;

    // The turn's own options, so the embedding call is budgeted, cancelled and
    // recorded by the same machinery as every other port call.
    const embedded = await embedder.embed([message], options);
    if (!embedded.ok) return null;

    const vector = embedded.value[0];
    if (vector === undefined) return null;

    // The one genuine sequence in retrieval: the search takes the vector the
    // line above produced. Everything else in this engine now runs alongside
    // this pair rather than behind it.
    const neighbours = await this.#memories.similar(
      query.companionId,
      query.userId,
      vector,
      embedder.model,
      this.#semanticLimit,
    );

    return { model: embedder.model, dimensions: embedder.dimensions, vector, neighbours };
  }

  /**
   * Folds the semantic neighbourhood into the recency set.
   *
   * Pure, and separated from the fetch above so the two halves can be awaited
   * at different times: the neighbourhood is fetched concurrently with the
   * candidate query, and this runs once both have arrived. `null` is the
   * fallback path — no embedder, a provider failure, or a store with no vector
   * search — and yields exactly what the sequential version returned for those
   * cases: the recency set with `semantic: null`.
   */
  #unionSemantic(
    recent: readonly Memory[],
    neighbourhood: SemanticNeighbourhood | null,
  ): { memories: readonly Memory[]; index: SemanticIndex | null } {
    if (neighbourhood === null) return { memories: recent, index: null };

    const { neighbours } = neighbourhood;

    // Union by id, recency first so its ordering survives for equally ranked
    // items. `similar` is already owner-scoped in SQL; this merge cannot widen
    // the set beyond what those two queries authorised.
    const byId = new Map<string, Memory>();
    for (const memory of recent) byId.set(memory.id, memory);
    for (const neighbour of neighbours) byId.set(neighbour.memory.id, neighbour.memory);
    const memories = [...byId.values()];

    // Keyed by `vectorId`, which is what `EmbeddingReference` actually names —
    // one memory may be embedded more than once and a re-embed must not resolve
    // to the old vector. A candidate the vector query did not return simply has
    // no entry here and is reported as `vector_absent` rather than scored zero,
    // which is the distinction that keeps a half-backfilled store honest.
    const vectors = new Map<string, readonly number[]>();
    for (const neighbour of neighbours) {
      const reference = neighbour.memory.embedding;
      if (reference === null) continue;
      vectors.set(reference.vectorId, neighbour.vector);
    }

    return {
      memories,
      index: {
        model: neighbourhood.model,
        dimensions: neighbourhood.dimensions,
        query: neighbourhood.vector,
        vectors,
      },
    };
  }
}

/**
 * What the vector half of retrieval produced, before it is folded in.
 *
 * Exists because the fetch and the union now happen at different moments:
 * the fetch runs alongside the other reads, the union waits for the candidate
 * set. `null` in place of one of these is the documented fallback, never an
 * error.
 */
interface SemanticNeighbourhood {
  readonly model: string;
  readonly dimensions: number;
  readonly vector: readonly number[];
  readonly neighbours: readonly SemanticNeighbour[];
}

/**
 * Planning, behind `DecisionAdvisorPort`.
 *
 * The seam Core already had for exactly this. It was documented as "the escape
 * valve for the day rule-based deliberation stops sufficing", written expecting
 * a model to fill it — and a *pure* planner fills it better, because the hint
 * arrives as an ordinary recorded context field and deliberation stays a pure
 * function of its input.
 *
 * Advisory, never binding. Core consults the hint only where its own rules were
 * unsure and never lets it override a confident rule. That remains correct even
 * though this planner is more thorough than the rules it advises: the rules are
 * on the latency path and guaranteed to run, and a companion whose behaviour
 * could be wholly redirected by an optional upstream capability would behave
 * differently depending on whether that capability was composed in.
 */
export class PlanningAdvisor implements DecisionAdvisorPort {
  readonly #scratchpad: TurnScratchpad;

  constructor(deps: { readonly scratchpad: TurnScratchpad }) {
    this.#scratchpad = deps.scratchpad;
  }

  async advise(
    request: DecisionAdviceRequest,
    options: PortOptions,
  ): Promise<DecisionHint | null> {
    const facts = this.#scratchpad.read(options.turnId);
    if (facts === null) return null;

    const conversationPlan = plan({
      at: facts.at,
      perception: facts.perception,
      retrieval: facts.retrieval,
      conversation: request.workingMemory,
      goals: request.goals,
      relationship: facts.relationship,
      expression: facts.expression,
      identity: currentIdentity(),
      plan: null,
    });

    // The full plan is kept even though Core only takes the hint. It is the
    // artefact that answers "why did it ask instead of answering?", and the
    // projection deliberately discards most of it.
    this.#scratchpad.record(options.turnId, { plan: conversationPlan });

    return toDecisionHint(conversationPlan);
  }
}

/**
 * The relationship record, behind `RelationshipPort`.
 *
 * Read-only, as the port requires. Advancing the relationship is a subscriber's
 * job — a write here would put the progression rules on the latency path and
 * make Core own an engine's internals.
 */
export class RelationshipRecord implements RelationshipPort {
  readonly #store: RelationshipStore;
  readonly #clock: Clock;

  constructor(deps: { readonly store: RelationshipStore; readonly clock: Clock }) {
    this.#store = deps.store;
    this.#clock = deps.clock;
  }

  async current(
    companionId: CompanionId,
    userId: UserId,
    _options: PortOptions,
  ): Promise<Relationship | null> {
    return this.#store.current(companionId, userId, timestamp(this.#clock.nowIso()));
  }
}

/**
 * Memory formation, behind `MemoryWritePort`.
 *
 * Replaces `RecordingMemoryWrite`, which appended candidates to an array so the
 * slice was observable end to end. This runs the real formation rules: the
 * proposal is measured against what is already remembered and becomes a store, a
 * reinforcement, a supersession or a rejection.
 *
 * `propose`, not `store`, and the name is still right. Core does not decide what
 * is worth remembering — it says something might be, and `@nexa/memory` decides.
 * That the decision now happens synchronously inside the adapter rather than in
 * a worker is a property of an in-memory store, not of the architecture: a
 * durable one enqueues here and the engine runs behind the queue.
 */
/**
 * Port options for embedding work that happens after the answer.
 *
 * `PortOptions` is shaped for calls made *during* a turn: a deadline carved
 * from the turn's budget, a signal that trips when the turn ends. Commit-stage
 * work outlives both, so it carries its own timeout instead. The cast is
 * confined here so the mismatch is stated once rather than at the call site.
 */
const embeddingOptions = (): PortOptions =>
  ({ signal: AbortSignal.timeout(15_000), turnId: 'embedding' } as unknown as PortOptions);

export class MemoryFormation implements MemoryWritePort {
  readonly #store: MemoryStore;
  readonly #scratchpad: TurnScratchpad;
  readonly #clock: Clock;
  readonly #decisions: FormationRecord[] = [];
  readonly #embedder: EmbeddingPort | null;
  readonly #onEmbeddingError: ((error: unknown) => void) | undefined;

  constructor(deps: {
    readonly store: MemoryStore;
    readonly scratchpad: TurnScratchpad;
    readonly clock: Clock;
    /** Absent means memories are stored without vectors, as before Step 3. */
    readonly embedder?: EmbeddingPort | null;
    readonly onEmbeddingError?: (error: unknown) => void;
  }) {
    this.#store = deps.store;
    this.#scratchpad = deps.scratchpad;
    this.#clock = deps.clock;
    this.#embedder = deps.embedder ?? null;
    this.#onEmbeddingError = deps.onEmbeddingError;
  }

  /** What formation decided, in order. Read by tests and by the replay harness. */
  get decisions(): readonly FormationRecord[] {
    return this.#decisions;
  }

  async propose(
    companionId: CompanionId,
    userId: UserId,
    candidate: MemoryCandidate,
    options: PortOptions,
  ): Promise<void> {
    const facts = this.#scratchpad.read(options.turnId);

    // The owner arrives on the port rather than being recovered from the
    // scratchpad, so a memory can no longer be written without one. Every
    // memory is scoped to a user, and the privacy story in
    // `18_Memory_Architecture.md` rests on that being true rather than
    // approximately true -- it is now the signature that guarantees it.
    const at = facts?.at ?? timestamp(this.#clock.nowIso());

    const decision = decide({
      proposal: {
        content: candidate.content,
        source: candidate.source,
        tags: candidate.tags,
        // The turn proposes; it does not assert that the user asked. Formation
        // treats an explicit request as the one signal that overrules its own
        // judgement, so claiming one here would be putting words in their mouth.
        statedExplicitly: false,
        salience: 0.5,
      },
      existing: await this.#store.all(companionId, userId),
      at,
      // No port supplies the user record yet. Null means "unknown", and
      // formation treats absent preferences as *not* permission — it is the one
      // gate that forbids rather than weighs.
      preferences: null,
      type: candidate.type,
    });

    const stored = await this.#store.apply(companionId, userId, decision, at);
    this.#decisions.push({
      companionId,
      outcome: decision.outcome,
      memoryId: stored?.id ?? null,
    });

    if (stored !== null) await this.#embed(companionId, userId, stored);
  }

  /**
   * Attaches a vector to a memory that already exists.
   *
   * Deliberately after the row is written and deliberately unable to fail the
   * write. `Memory.embedding` has always been documented as null until the
   * worker runs — a memory is readable before it is searchable — so an
   * embedding provider that is down costs semantic ranking on that memory
   * until the backfill catches it, and costs nothing else.
   *
   * `vectorId` is minted fresh rather than reusing the memory id, because one
   * memory may be embedded more than once and a re-embed must not resolve to
   * the previous vector.
   */
  async #embed(companionId: CompanionId, userId: UserId, memory: Memory): Promise<void> {
    const embedder = this.#embedder;
    if (embedder === null) return;

    try {
      // Deliberately *not* the turn's options. This runs in the commit stage,
      // after the answer exists and after the turn's budget has been spent on
      // producing it — handing it a deadline that is already exhausted meant
      // the call aborted before it left the process and every memory was
      // stored without a vector. Post-answer work gets its own clock.
      const embedded = await embedder.embed([memory.content], embeddingOptions());
      if (!embedded.ok) {
        this.#onEmbeddingError?.(embedded.error);
        return;
      }
      const vector = embedded.value[0];
      if (vector === undefined) return;

      await this.#store.attachEmbedding(companionId, userId, memory.id, vector, {
        model: embedder.model,
        dimensions: embedder.dimensions,
        vectorId: `${memory.id}:${String(Date.now())}`,
        embeddedAt: timestamp(this.#clock.nowIso()),
      });
    } catch (error) {
      this.#onEmbeddingError?.(error);
    }
  }
}

export interface FormationRecord {
  readonly companionId: CompanionId;
  readonly outcome: 'store' | 'reinforce' | 'supersede' | 'reject' | 'declined_no_owner';
  readonly memoryId: string | null;
}

/** Re-exported so the composition root has one import for the instant type. */
export type { Timestamp };
