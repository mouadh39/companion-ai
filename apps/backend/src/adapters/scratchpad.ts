import type { CompanionId, TurnId, UserId } from '@nexa/shared';
import type {
  ConversationPlan,
  ExpressionProfile,
  PerceptionOutcome,
  RelationshipProfile,
  RetrievalOutcome,
  Timestamp,
} from '@nexa/models';

/**
 * What the engines produced for one turn, so later adapters can read it.
 *
 * ## Why this exists
 *
 * Core's ports were designed one at a time and each carries exactly what its
 * own consumer needed. `MemoryRetrievalPort.retrieve` receives a
 * `RetrievalQuery`; `DecisionAdvisorPort.advise` receives a
 * `DecisionAdviceRequest`. Neither carries a `PerceptionOutcome`, because when
 * those interfaces were written no such thing existed.
 *
 * `@nexa/retrieval` and `@nexa/planning` both need it. Widening Core's ports to
 * carry it would make Core aware of vocabulary that belongs to two capability
 * packages it must never import — the one rule Phase A never relaxed. So the
 * adapters share it here instead, in the composition root, which is the only
 * place in the system permitted to know both sides.
 *
 * ## This is not hidden state
 *
 * Every value in it is the output of a **pure function of that turn's inputs**.
 * The same message, at the same instant, against the same store produces the
 * same perception, the same retrieval and the same plan — so a replayed turn
 * fills this with byte-identical contents. It is a memo of work already done,
 * not a place where decisions accumulate.
 *
 * Two properties keep it honest, and both are enforced rather than promised:
 *
 * - **Keyed by `TurnId`.** Two concurrent turns cannot see each other's facts,
 *   and a reader that asks for a turn nobody opened gets `null` rather than
 *   somebody else's answer.
 * - **Bounded.** It is a ring of the last `maxTurns` turns, evicted oldest-first.
 *   Nothing releases an entry explicitly, and that is deliberate: a turn's
 *   cognitive artefacts stay readable after it finishes, which is what the
 *   replay harness and a future debug surface need. A map that grew with traffic
 *   would be the sort of defect that only appears in production; a fixed ring
 *   cannot be.
 */

export interface TurnFacts {
  /**
   * Null until an adapter that knows them has run.
   *
   * `PerceptionPort.perceive` opens the scratchpad and receives only the message
   * and the turn id — the stage it serves needs neither identifier. Retrieval
   * runs next and carries both, so it fills them in. A turn where retrieval
   * failed therefore reaches the commit stage without them, which is a recorded
   * degradation rather than a silent one: memory formation declines rather than
   * inventing an owner for someone's memory.
   */
  readonly companionId: CompanionId | null;
  readonly userId: UserId | null;
  /** Sampled once, at the start of the turn. Every engine is given this one. */
  readonly at: Timestamp;
  readonly message: string;
  readonly perception: PerceptionOutcome;
  /** Null until the relationship contributor has run. */
  readonly relationship: RelationshipProfile | null;
  /** Null until the expression contributor has run. */
  readonly expression: ExpressionProfile | null;
  /** Null until retrieval has run. */
  readonly retrieval: RetrievalOutcome | null;
  /** Null until the advisor has run. The full plan Core's hint was projected from. */
  readonly plan: ConversationPlan | null;
}

/** What the perception adapter establishes before anything else can proceed. */
export interface TurnOpening {
  readonly at: Timestamp;
  readonly message: string;
  readonly perception: PerceptionOutcome;
}

export class TurnScratchpad {
  readonly #facts = new Map<TurnId, TurnFacts>();
  readonly #maxTurns: number;

  constructor(maxTurns = 256) {
    this.#maxTurns = maxTurns;
  }

  /**
   * Records what perception established, and evicts the oldest turn if full.
   *
   * Insertion order is eviction order. `Map` preserves it, so the oldest key is
   * the first one iteration yields — no timestamps, no comparator, and nothing
   * that could disagree with the order things actually happened in.
   */
  open(turnId: TurnId, opening: TurnOpening): void {
    if (this.#facts.size >= this.#maxTurns) {
      const oldest = this.#facts.keys().next();
      if (!oldest.done) this.#facts.delete(oldest.value);
    }

    this.#facts.set(turnId, {
      ...opening,
      companionId: null,
      userId: null,
      relationship: null,
      expression: null,
      retrieval: null,
      plan: null,
    });
  }

  /**
   * Adds to what is known about a turn.
   *
   * A no-op for a turn that was never opened, rather than an error. Perception
   * runs first and always; if it did not, the turn has already failed and a
   * second failure from a bookkeeping call would obscure the first.
   */
  record(turnId: TurnId, patch: Partial<Omit<TurnFacts, 'at' | 'message' | 'perception'>>): void {
    const held = this.#facts.get(turnId);
    if (held === undefined) return;
    this.#facts.set(turnId, { ...held, ...patch });
  }

  read(turnId: TurnId): TurnFacts | null {
    return this.#facts.get(turnId) ?? null;
  }

  /** For tests and diagnostics. Never read by an adapter. */
  get size(): number {
    return this.#facts.size;
  }
}
