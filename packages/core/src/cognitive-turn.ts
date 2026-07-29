import {
  type Clock,
  type CompanionId,
  type Result,
  type TurnId,
  type UserId,
  err,
  newDecisionId,
  newTurnId,
  ok,
} from '@nexa/shared';
import type { Decision } from '@nexa/models';
import { isDegraded } from '@nexa/models';
import type { Action } from '@nexa/actions';
import { validateActions } from '@nexa/actions';
import {
  type EventBus,
  type EventCorrelation,
  type TurnStage,
  actionGenerated,
  decisionMade,
  memoryCandidateCreated,
  turnCompleted,
  turnFailed,
  turnStarted,
} from '@nexa/events';
import type { ContextAssembler } from './context-assembler.js';
import { deliberate } from './deliberator.js';
import type { ActionGenerator } from './action-generator.js';
import type { MemoryWritePort, PerceptionPort, WorkingMemoryPort } from './ports.js';

/**
 * One pass from a message arriving to actions leaving.
 *
 * A synchronous, ordered pipeline — deliberately not an event chain. The turn
 * needs return values and guaranteed ordering, and expressing it as events
 * would mean inventing correlation ids and a response-waiting mechanism: a
 * synchronous call reimplemented badly. It would also destroy the call tree
 * that explainability depends on.
 *
 * Events are emitted *from* the stages, for everything that happens afterwards.
 * That is CQRS in its useful form: the turn is a command, everything downstream
 * is a projection.
 */

export interface TurnRequest {
  readonly companionId: CompanionId;
  readonly userId: UserId;
  readonly text: string;
  readonly source: 'user' | 'autonomous';
}

export interface TurnResult {
  readonly turnId: TurnId;
  readonly actions: readonly Action[];
  readonly decision: Decision;
  /** True when any context section was dropped — the answer may be thinner. */
  readonly degraded: boolean;
  readonly durationMs: number;
}

export interface TurnFailure {
  readonly turnId: TurnId;
  readonly stage: TurnStage;
  readonly error: Error;
}

export interface CognitiveTurnDependencies {
  readonly perception: PerceptionPort;
  readonly assembler: ContextAssembler;
  readonly generator: ActionGenerator;
  readonly workingMemory: WorkingMemoryPort;
  readonly memoryWrite: MemoryWritePort;
  readonly events: EventBus;
  readonly clock: Clock;
}

export class CognitiveTurn {
  readonly #deps: CognitiveTurnDependencies;

  constructor(dependencies: CognitiveTurnDependencies) {
    this.#deps = dependencies;
  }

  async run(request: TurnRequest): Promise<Result<TurnResult, TurnFailure>> {
    const { clock, events } = this.#deps;
    const turnId = newTurnId();
    const startedAt = clock.now();

    const correlation: EventCorrelation = {
      companionId: request.companionId,
      userId: request.userId,
      turnId,
      causedBy: null,
    };

    const fail = (stage: TurnStage, error: Error): Result<never, TurnFailure> => {
      void events.publish(turnFailed(correlation, { stage, reason: error.message }));
      return err({ turnId, stage, error });
    };

    // ── 2. Perception ────────────────────────────────────────────────────
    let perception;
    try {
      perception = await this.#deps.perception.perceive(request.text);
    } catch (error) {
      return fail('perception', toError(error));
    }

    await events.publish(
      turnStarted(correlation, {
        source: request.source,
        intent: perception.intents[0]?.kind ?? null,
      }),
    );

    // ── 3. Context assembly — the only stage that performs I/O ────────────
    let context;
    try {
      context = await this.#deps.assembler.assemble({
        turnId,
        companionId: request.companionId,
        userId: request.userId,
        perception,
      });
    } catch (error) {
      return fail('context_assembly', toError(error));
    }

    // ── 4. Deliberation — pure ───────────────────────────────────────────
    // The id is stamped here rather than inside `deliberate`, which must stay
    // free of randomness for its output to be reproducible from its input.
    const draft = deliberate(context);
    const decision: Decision = { ...draft, id: newDecisionId() };

    await events.publish(
      decisionMade(correlation, {
        decisionId: decision.id,
        kind: decision.kind,
        confidence: decision.confidence,
        reasonCodes: decision.reasonCodes,
        alternatives: decision.alternatives,
      }),
    );

    // ── 5. Generation ────────────────────────────────────────────────────
    const generated = await this.#deps.generator.generate(context, decision);
    if (!generated.ok) {
      return fail('generation', generated.error);
    }

    // ── 6. Validation ────────────────────────────────────────────────────
    // Rejected actions are dropped and reported, never fatal: one malformed
    // gesture must not cost the user the answer that came with it.
    const { accepted } = validateActions(generated.value);

    // ── 7. Commit ────────────────────────────────────────────────────────
    try {
      await this.#deps.workingMemory.append(request.companionId, {
        role: 'user',
        content: request.text,
        at: context.at,
      });

      const spoken = accepted.find((action) => action.type === 'speak');
      if (spoken !== undefined && spoken.type === 'speak') {
        await this.#deps.workingMemory.append(request.companionId, {
          role: 'companion',
          content: spoken.text,
          at: clock.nowIso(),
        });
      }
    } catch (error) {
      return fail('commit', toError(error));
    }

    for (const action of accepted) {
      await events.publish(
        actionGenerated(correlation, {
          actionId: action.id,
          actionType: action.type,
          decisionId: decision.id,
        }),
      );
    }

    // Long-term memory is proposed as an event, never written synchronously —
    // the user should not wait on consolidation.
    if (decision.kind === 'remember') {
      const candidate = {
        content: request.text,
        type: 'semantic' as const,
        source: 'user_stated' as const,
        tags: perception.entities,
      };
      await this.#deps.memoryWrite.propose(request.companionId, candidate);
      await events.publish(
        memoryCandidateCreated(correlation, {
          candidateId: turnId,
          memoryType: candidate.type,
          summary: truncate(candidate.content, 120),
        }),
      );
    }

    const durationMs = clock.now() - startedAt;
    const degraded = isDegraded(context.budget);

    await events.publish(
      turnCompleted(correlation, { actionCount: accepted.length, durationMs, degraded }),
    );

    return ok({ turnId, actions: accepted, decision, degraded, durationMs });
  }
}

const toError = (value: unknown): Error =>
  value instanceof Error ? value : new Error(String(value));

const truncate = (text: string, max: number): string =>
  text.length <= max ? text : `${text.slice(0, max - 1)}…`;
