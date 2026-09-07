import {
  type Clock,
  type CompanionId,
  type Result,
  type SessionId,
  type TurnId,
  type UserId,
  err,
  newDecisionId,
  newTurnId,
  ok,
} from '@nexa/shared';
import type {
  ClientCapabilities,
  CognitiveContext,
  Decision,
  TurnRecord,
  TurnSource,
} from '@nexa/models';
import { canRender, isDegraded, timestamp } from '@nexa/models';
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
import type { PortOptions, TurnBudget } from './execution/index.js';
import { Deadline, callPort, defaultTurnBudget } from './execution/index.js';
import { ContextUnavailableError, TurnAbortedError } from './errors.js';
import { TurnRecordBuilder } from './turn-record.js';
import type { IdempotencyStore, ReleaseTurn, TurnGate } from './admission/index.js';
import type { TurnSink } from './generation/index.js';
import { deliver } from './generation/index.js';
import type { Observability } from './observability/index.js';
import { noopObservability, reportTurn } from './observability/index.js';
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
  readonly source: TurnSource;

  /**
   * Which client connection this came from.
   *
   * Not a conversation id. Two devices talking to one companion are two
   * sessions and one conversation, and the thing a stream reconnects to is not
   * the thing the companion remembers.
   */
  readonly sessionId?: SessionId;

  /**
   * What the client can actually execute.
   *
   * Omitted means "unknown", which is treated as unrestricted — absence of a
   * declaration is not evidence of incapability, and filtering on a guess would
   * break every client that has not been updated to declare itself.
   */
  readonly clientCapabilities?: ClientCapabilities;

  /**
   * Absolute epoch milliseconds after which the caller stops caring.
   *
   * The caller owns the latency contract, not Core. A client with a spinner
   * knows when the answer stops being worth waiting for; a constant compiled
   * into the backend does not.
   */
  readonly deadline?: number;

  /** Makes a client retry free rather than a second turn with real side effects. */
  readonly idempotencyKey?: string;

  /**
   * Where to deliver output as it becomes available.
   *
   * Streaming is a sink the caller supplies rather than a change to `run()`'s
   * return type — an `AsyncIterable` would force tests, the worker, and
   * autonomous turns into an iteration protocol they have no use for.
   */
  readonly sink?: TurnSink;

  /**
   * Cancellation from the caller — a closed connection, a user who navigated
   * away. Linked to the turn's own controller, so aborting it stops the work
   * rather than merely stopping the wait for it.
   */
  readonly signal?: AbortSignal;
}

export interface TurnResult {
  readonly turnId: TurnId;
  readonly actions: readonly Action[];
  readonly decision: Decision;
  /** True when any context section was dropped — the answer may be thinner. */
  readonly degraded: boolean;
  readonly durationMs: number;
  /** The audit artifact. Never read by anything that reasons. */
  readonly record: TurnRecord;
}

export interface TurnFailure {
  readonly turnId: TurnId;
  readonly stage: TurnStage;
  readonly error: Error;
  /**
   * Present on failure too, and that is the point: a turn that failed is the
   * one you most need the timings and port outcomes for.
   */
  readonly record: TurnRecord;
}

export interface CognitiveTurnDependencies {
  readonly perception: PerceptionPort;
  readonly assembler: ContextAssembler;
  readonly generator: ActionGenerator;
  readonly workingMemory: WorkingMemoryPort;
  readonly memoryWrite: MemoryWritePort;
  readonly events: EventBus;
  readonly clock: Clock;
  /** Stage allotments. Defaults are generous; callers with a real latency
   *  contract are expected to pass a deadline rather than tune these. */
  readonly budget?: TurnBudget;
  /**
   * Serialises turns per companion. Omitted means turns may overlap, which is
   * only safe for a single-client deployment.
   */
  readonly gate?: TurnGate;
  /** Replays a retried turn instead of running it again. */
  readonly idempotency?: IdempotencyStore<TurnResult>;
  /** Metrics, tracing and logging. Defaults to implementations that do nothing. */
  readonly observability?: Observability;
}

export class CognitiveTurn {
  readonly #deps: CognitiveTurnDependencies;
  readonly #budget: TurnBudget;
  readonly #observability: Observability;

  constructor(dependencies: CognitiveTurnDependencies) {
    this.#deps = dependencies;
    this.#budget = dependencies.budget ?? defaultTurnBudget;
    this.#observability = dependencies.observability ?? noopObservability;
  }

  /**
   * Runs one turn, reporting it exactly once however it ends.
   *
   * The reporting wrapper sits outside the pipeline rather than inside it
   * because the pipeline returns from a dozen places, and a metric emitted at
   * each of them is a metric that eventually gets missed at one.
   */
  async run(request: TurnRequest): Promise<Result<TurnResult, TurnFailure>> {
    const { metrics, tracer, logger } = this.#observability;
    const span = tracer.startSpan('nexa.turn', { 'nexa.source': request.source });

    try {
      const outcome = await this.#execute(request);
      const record = outcome.ok ? outcome.value.record : outcome.error.record;

      span.setAttribute('nexa.turn_id', record.turnId);
      span.setAttribute('nexa.outcome', record.outcome);
      span.setAttribute('nexa.degraded', record.degraded);
      if (record.decision !== null) {
        span.setAttribute('nexa.decision', record.decision.kind);
        span.setAttribute('nexa.confidence', record.decision.confidence);
      }
      if (!outcome.ok) span.recordError(outcome.error.error);

      reportTurn(metrics, record);

      // Never the message and never a memory. The user's private life belongs
      // at debug, behind a flag that is off in production.
      logger.log(outcome.ok ? 'info' : 'error', `turn ${record.outcome}`, {
        turnId: record.turnId,
        companionId: record.companionId,
        userId: record.userId,
        durationMs: record.durationMs,
        degraded: record.degraded,
        ...(record.failedStage !== null ? { failedStage: record.failedStage } : {}),
      });

      return outcome;
    } finally {
      span.end();
    }
  }

  async #execute(request: TurnRequest): Promise<Result<TurnResult, TurnFailure>> {
    const { clock, events } = this.#deps;
    const turnId = newTurnId();
    const startedAt = clock.now();

    // One deadline and one controller own the whole turn. Every stage receives
    // a subdivision of the first and the signal of the second, so cancelling
    // here stops work everywhere rather than merely stopping the waiting.
    const controller = new AbortController();
    const linked = linkCaller(controller, request.signal);

    // The caller's deadline wins when it supplies one: it knows when the answer
    // stops being worth waiting for, and a constant compiled in here does not.
    const deadline =
      request.deadline === undefined
        ? Deadline.after(clock, this.#budget.totalMs)
        : Deadline.at(clock, request.deadline);

    const options: PortOptions = { signal: controller.signal, deadline, turnId };

    const record = new TurnRecordBuilder({
      clock,
      turnId,
      companionId: request.companionId,
      userId: request.userId,
      source: request.source,
      tracer: this.#observability.tracer,
    });

    const correlation: EventCorrelation = {
      companionId: request.companionId,
      userId: request.userId,
      turnId,
      causedBy: null,
    };

    const fail = (stage: TurnStage, error: Error): Result<never, TurnFailure> => {
      void events.publish(turnFailed(correlation, { stage, reason: error.message }));
      return err({
        turnId,
        stage,
        error,
        record: record.build({
          outcome: error instanceof TurnAbortedError ? 'aborted' : 'failed',
          actions: [],
          failedStage: stage,
          failureReason: error.message,
        }),
      });
    };

    // ── 0. Admission ─────────────────────────────────────────────────────
    // Three cheap checks that each prevent a different silent corruption:
    // an expired turn spends a provider call nobody will read, a retry becomes
    // a duplicate with real side effects, and concurrent turns for one
    // companion interleave their writes to working memory.
    const endAdmission = record.beginStage('admission');

    if (deadline.hasExpired()) {
      record.diagnose('deadline_exhausted', 'error', 'The deadline had passed on arrival.');
      endAdmission();
      linked.dispose();
      return fail('admission', new Error('The turn deadline had already passed.'));
    }

    const idempotency = this.#deps.idempotency;
    const idempotencyKey = request.idempotencyKey;
    if (idempotency !== undefined && idempotencyKey !== undefined) {
      const replayed = await idempotency.lookup(idempotencyKey);
      if (replayed !== undefined) {
        endAdmission();
        linked.dispose();
        // Returned verbatim, including the original turn id. A retry that
        // produced a *new* id would defeat the purpose: the client could not
        // tell the two responses referred to one exchange.
        return ok(replayed);
      }
    }

    let release: ReleaseTurn | null = null;
    if (this.#deps.gate !== undefined) {
      release = await this.#deps.gate.acquire(request.companionId, options);
      if (release === null) {
        endAdmission();
        linked.dispose();
        return fail(
          'admission',
          new TurnAbortedError('admission waiting for the companion'),
        );
      }
    }
    endAdmission();

    try {
      const outcome = await this.#pipeline(request, {
        turnId,
        startedAt,
        options,
        controller,
        deadline,
        record,
        correlation,
        fail,
      });

      if (outcome.ok && idempotency !== undefined && idempotencyKey !== undefined) {
        await idempotency.remember(idempotencyKey, outcome.value);
      }

      return outcome;
    } finally {
      // Released before the result reaches the caller, so the next queued turn
      // starts while this response is still being serialised.
      release?.();
      linked.dispose();
    }
  }

  async #pipeline(
    request: TurnRequest,
    scope: PipelineScope,
  ): Promise<Result<TurnResult, TurnFailure>> {
    const { clock, events } = this.#deps;
    const { turnId, startedAt, options, controller, deadline, record, correlation, fail } =
      scope;

    // ── 2. Perception ────────────────────────────────────────────────────
    // Fatal rather than degradable: everything downstream reasons about intent,
    // and there is no thinner version of "we do not know what was said".
    const endPerception = record.beginStage('perception');
    const perceptionCall = await callPort(
      'perception',
      this.#budget.perceptionMs,
      options,
      (scoped) => this.#deps.perception.perceive(request.text, scoped),
    );
    record.recordPortCall(perceptionCall);
    endPerception();

    if (perceptionCall.outcome !== 'ok') {
      return fail(
        'perception',
        perceptionCall.outcome === 'error'
          ? perceptionCall.error
          : new Error(`Perception did not complete (${perceptionCall.outcome}).`),
      );
    }
    const perception = perceptionCall.value;

    await events.publish(
      turnStarted(correlation, {
        source: request.source,
        intent: perception.intents[0]?.kind ?? null,
      }),
    );

    // ── 3. Context assembly — the only stage that performs I/O ────────────
    const endAssembly = record.beginStage('context_assembly');
    let context: CognitiveContext;
    try {
      const assembled = await this.#deps.assembler.assemble({
        turnId,
        companionId: request.companionId,
        userId: request.userId,
        perception,
        clientCapabilities: request.clientCapabilities ?? null,
        options,
      });
      context = assembled.context;
      record.recordPortCalls(assembled.portCalls);
      record.recordContext(context);
    } catch (error) {
      endAssembly();
      // The calls made before a fatal section failed are exactly the ones that
      // explain the outage, so they are carried on the error rather than lost.
      if (error instanceof ContextUnavailableError) {
        for (const call of error.portCalls) record.recordRawPortCall(call);
      }
      return fail('context_assembly', toError(error));
    }
    endAssembly();

    // ── 4. Deliberation — pure ───────────────────────────────────────────
    // The id is stamped here rather than inside `deliberate`, which must stay
    // free of randomness for its output to be reproducible from its input.
    const endDeliberation = record.beginStage('deliberation');
    const draft = deliberate(context);
    const decision: Decision = { ...draft, id: newDecisionId() };
    record.recordDecision(decision);
    endDeliberation();

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
    // Handed the deadline less the commit reserve, so a slow provider costs a
    // shorter answer rather than an answer the companion fails to remember.
    const generationOptions: PortOptions = {
      signal: controller.signal,
      deadline: deadline.withReserve(this.#budget.commitReserveMs),
      turnId,
    };
    const endGeneration = record.beginStage('generation');
    const generated = await this.#deps.generator.generate(
      context,
      decision,
      generationOptions,
      request.sink,
    );

    // Folded in before the failure check: the measurements matter most when
    // generation failed, because they say how far the loop got and what it
    // already cost.
    for (const modelCall of generated.modelCalls) record.recordModelCall(modelCall);
    for (const diagnostic of generated.diagnostics) {
      record.diagnose(diagnostic.code, diagnostic.severity, diagnostic.detail);
    }
    endGeneration();

    if (generated.failure !== null) {
      return fail('generation', generated.failure);
    }

    // ── 6. Validation ────────────────────────────────────────────────────
    // Rejected actions are dropped and reported, never fatal: one malformed
    // gesture must not cost the user the answer that came with it. Reporting is
    // what makes the drop diagnosable — a silently vanished gesture is
    // indistinguishable from a companion that simply never gestures.
    const endValidation = record.beginStage('validation');
    const { accepted: valid, rejected } = validateActions(generated.actions);
    for (const rejection of rejected) record.recordRejection(rejection);

    // Actions the client cannot execute are dropped here rather than shipped
    // and silently discarded on the far side. A gesture that vanishes into a
    // voice-only client is indistinguishable from a companion that never
    // gestures, which is exactly the bug this makes visible.
    const capabilities = request.clientCapabilities;
    const accepted =
      capabilities === undefined
        ? valid
        : valid.filter((action) => {
            if (canRender(capabilities, action.type)) return true;
            record.recordUnsupported(action.type);
            return false;
          });

    // Delivered after filtering, never before: a client must not be handed an
    // action it cannot execute and then told to forget it.
    for (const action of accepted) {
      deliver(request.sink, (sink) => sink.onAction?.(action));
    }
    endValidation();

    // ── 7. Commit ────────────────────────────────────────────────────────
    const endCommit = record.beginStage('commit');
    try {
      await this.#deps.workingMemory.append(
        request.companionId,
        request.userId,
        { role: 'user', content: request.text, at: context.at },
        options,
      );

      const spoken = accepted.find((action) => action.type === 'speak');
      if (spoken !== undefined && spoken.type === 'speak') {
        await this.#deps.workingMemory.append(
          request.companionId,
          request.userId,
          { role: 'companion', content: spoken.text, at: timestamp(clock.nowIso()) },
          options,
        );
      }
    } catch (error) {
      endCommit();
      if (error instanceof TurnAbortedError) return fail('commit', error);
      return fail('commit', toError(error));
    }
    endCommit();

    const endPublish = record.beginStage('publish');

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
      await this.#deps.memoryWrite.propose(
        request.companionId,
        request.userId,
        candidate,
        options,
      );
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
    endPublish();

    return ok({
      turnId,
      actions: accepted,
      decision,
      degraded,
      durationMs,
      record: record.build({ outcome: 'completed', actions: accepted }),
    });
  }
}

/**
 * What stages 2–8 share.
 *
 * Bundled so admission can wrap the pipeline in a `try/finally` that always
 * releases the companion, without every stage growing another parameter. It is
 * per-turn state and is never held anywhere beyond `run`.
 */
interface PipelineScope {
  readonly turnId: TurnId;
  readonly startedAt: number;
  readonly options: PortOptions;
  readonly controller: AbortController;
  readonly deadline: Deadline;
  readonly record: TurnRecordBuilder;
  readonly correlation: EventCorrelation;
  readonly fail: (stage: TurnStage, error: Error) => Result<never, TurnFailure>;
}

/**
 * Forwards the caller's cancellation into the turn's own controller.
 *
 * Two controllers rather than reusing the caller's, because the turn also
 * cancels itself — on a deadline, or when a stage decides to stop — and
 * aborting a signal it does not own would cancel work belonging to whoever
 * supplied it.
 *
 * The listener is removed on disposal. A long-lived caller signal accumulating
 * one listener per turn is a slow leak that only shows up under load.
 */
const linkCaller = (
  controller: AbortController,
  callerSignal: AbortSignal | undefined,
): { dispose: () => void } => {
  if (callerSignal === undefined) return { dispose: () => undefined };

  if (callerSignal.aborted) {
    controller.abort(callerSignal.reason);
    return { dispose: () => undefined };
  }

  const forward = (): void => {
    controller.abort(callerSignal.reason);
  };
  callerSignal.addEventListener('abort', forward, { once: true });

  return {
    dispose: () => {
      callerSignal.removeEventListener('abort', forward);
    },
  };
};

const toError = (value: unknown): Error =>
  value instanceof Error ? value : new Error(String(value));

const truncate = (text: string, max: number): string =>
  text.length <= max ? text : `${text.slice(0, max - 1)}…`;
