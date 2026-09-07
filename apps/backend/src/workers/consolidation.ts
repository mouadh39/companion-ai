import type { Clock, CompanionId, UserId } from '@nexa/shared';
import type { InteractionSignal, IntentKind } from '@nexa/models';
import { primaryIntent, timestamp } from '@nexa/models';
import type { EventBus } from '@nexa/events';
import { reflect } from '@nexa/reflection';
import { advance } from '@nexa/relationship';
import { toPerception } from '@nexa/perception';
import type { TurnScratchpad } from '../adapters/scratchpad.js';
import type {
  InsightStore,
  MemoryStore,
  RelationshipStore,
} from '../adapters/store-ports.js';

/**
 * What happens after the user has their answer.
 *
 * Reflection and relationship progression both run here, on
 * `nexa.turn.completed`, and neither is a port. That is a decision Phase A made
 * and this wiring honours: Core publishes, consumers listen. A `ReflectionPort`
 * would put pattern discovery over a user's whole history on the latency path of
 * "how was your day?".
 *
 * The bus does not await handlers, so a slow or failing consolidation cannot
 * delay or fail a turn that has already succeeded. That is the intended
 * relationship between the two timescales, not a limitation of it.
 *
 * ## Why both live in one subscriber
 *
 * They share a trigger, a clock read and the same turn facts, and they advance
 * the same conversation. Two subscribers would read the same scratchpad entry
 * and take two clock readings a microtask apart, so a memory formed by one and a
 * relationship advanced by the other would disagree about when the turn was —
 * which is precisely the drift a single sampled instant exists to prevent.
 */

export interface ConsolidationDeps {
  readonly events: EventBus;
  readonly clock: Clock;
  readonly scratchpad: TurnScratchpad;
  readonly memories: MemoryStore;
  readonly insights: InsightStore;
  readonly relationships: RelationshipStore;
  readonly onError?: (error: unknown) => void;
}

/** What one consolidation pass did. Recorded so tests can assert it ran. */
export interface ConsolidationRecord {
  readonly turnId: string;
  readonly insightDecisions: number;
  readonly relationshipAdvanced: boolean;
  readonly stage: string | null;
}

export class Consolidation {
  readonly #deps: ConsolidationDeps;
  readonly #passes: ConsolidationRecord[] = [];

  constructor(deps: ConsolidationDeps) {
    this.#deps = deps;
  }

  /** Everything this subscriber has done. Read by tests and the harness. */
  get passes(): readonly ConsolidationRecord[] {
    return this.#passes;
  }

  /** Subscribes to turn completion. Returns the unsubscribe, as the bus does. */
  start(): () => void {
    return this.#deps.events.subscribe('nexa.turn.completed', async (event) => {
      try {
        await this.#run(event.turnId, event.companionId, event.userId);
      } catch (error) {
        // Contained. By the time this runs the turn has already succeeded and
        // the user has been answered; a failure here must never surface as one.
        this.#deps.onError?.(error);
      }
    });
  }

  async #run(
    turnId: ConsolidationRecord['turnId'] | null,
    companionId: CompanionId,
    userId: UserId,
  ): Promise<void> {
    if (turnId === null) return;

    const facts = this.#deps.scratchpad.read(turnId as never);
    if (facts === null) return;

    const at = timestamp(this.#deps.clock.nowIso());

    // ── reflection ──────────────────────────────────────────────────────
    // Runs over the whole store rather than over this turn's memories. A
    // pattern is by definition not visible in one turn, which is why this is
    // not something the turn could have done for itself.
    const result = reflect({
      userId,
      memories: await this.#deps.memories.all(companionId, userId),
      existing: await this.#deps.insights.all(companionId, userId),
      at,
    });

    const acted = result.decisions.filter((decision) => decision.outcome !== 'decline');
    if (acted.length > 0) {
      await this.#deps.insights.apply(companionId, userId, result.decisions);
    }

    // ── relationship ────────────────────────────────────────────────────
    const before = await this.#deps.relationships.current(companionId, userId, at);
    const update = advance(before, this.#signalFrom(facts, at));
    await this.#deps.relationships.save(update.relationship);

    this.#passes.push({
      turnId,
      insightDecisions: acted.length,
      relationshipAdvanced: update.stageChange !== null,
      stage: update.relationship.type,
    });
  }

  /**
   * What this turn contributed to the relationship.
   *
   * Structural facts only — what kind of exchange it was, how deep, whether the
   * companion was corrected. No emotional reading and no content, because a
   * relationship that moved on the companion's guesses about someone would grow
   * from what it imagined rather than from what happened between them.
   *
   * The intent is taken from perception's own projection rather than re-derived,
   * so the relationship advances on the same reading the turn acted on.
   */
  #signalFrom(
    facts: NonNullable<ReturnType<TurnScratchpad['read']>>,
    at: ReturnType<typeof timestamp>,
  ): InteractionSignal {
    const projected = toPerception(facts.perception, []);
    const intent: IntentKind = primaryIntent(projected);

    const corrected = facts.perception.observations.some(
      (observation) => observation.dimension === 'correction',
    );
    const acknowledgedUncertainty = facts.plan?.constraints.includes('disclose_uncertainty') ?? false;

    return {
      at,
      intent,
      exchangeTurns: 1,
      corrected,
      acknowledgedUncertainty,
    };
  }
}
