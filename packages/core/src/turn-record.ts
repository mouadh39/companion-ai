import type { Clock, CompanionId, TurnId, UserId } from '@nexa/shared';
import type {
  Action,
  ActionType,
  CognitiveContext,
  Decision,
  Diagnostic,
  DiagnosticCode,
  DiagnosticSeverity,
  ModelCall,
  PortCallRecord,
  RejectedActionRecord,
  RejectionReason,
  SectionOmission,
  TurnRecord,
  TurnSource,
  TurnStage,
} from '@nexa/models';
import { isDegraded, timestamp } from '@nexa/models';
import type { PortCall } from './execution/index.js';
import { toRecord } from './execution/index.js';
import type { Tracer } from './observability/index.js';
import { noopTracer } from './observability/index.js';

/**
 * Accumulates the audit artifact while the turn runs.
 *
 * Mutable, and therefore here rather than in `@nexa/models` — that package
 * holds shapes, this holds the behaviour that fills one in. The builder is
 * created per turn and dies with it; nothing else may hold a reference, because
 * a shared builder would interleave two turns' measurements.
 *
 * Every method returns void and none can throw. Recording is observability, and
 * observability that can fail a turn is worse than no observability: an
 * exception here would end a turn that had already produced a good answer.
 */
export class TurnRecordBuilder {
  readonly #clock: Clock;
  readonly #turnId: TurnId;
  readonly #companionId: CompanionId;
  readonly #userId: UserId;
  readonly #source: TurnSource;
  readonly #startedAtMs: number;
  readonly #startedAt: string;

  readonly #stageTimings: Partial<Record<TurnStage, number>> = {};
  readonly #portCalls: PortCallRecord[] = [];
  readonly #modelCalls: ModelCall[] = [];
  readonly #rejectedActions: RejectedActionRecord[] = [];
  readonly #diagnostics: Diagnostic[] = [];

  readonly #tracer: Tracer;
  #decision: Decision | null = null;
  #omissions: readonly SectionOmission[] = [];
  #degraded = false;
  #contextRef: string | null = null;
  /** The stage currently open, so a diagnostic can attribute itself. */
  #currentStage: TurnStage = 'ingress';

  constructor(seed: {
    readonly clock: Clock;
    readonly turnId: TurnId;
    readonly companionId: CompanionId;
    readonly userId: UserId;
    readonly source: TurnSource;
    /** Opens a child span per stage. Defaults to one that does nothing. */
    readonly tracer?: Tracer;
  }) {
    this.#tracer = seed.tracer ?? noopTracer;
    this.#clock = seed.clock;
    this.#turnId = seed.turnId;
    this.#companionId = seed.companionId;
    this.#userId = seed.userId;
    this.#source = seed.source;
    this.#startedAtMs = seed.clock.now();
    this.#startedAt = seed.clock.nowIso();
  }

  /**
   * Opens a stage and returns the function that closes it.
   *
   * A returned closure rather than a `time(stage, fn)` wrapper because the
   * pipeline returns early from most stages; wrapping each in a callback would
   * force every early return through a sentinel value.
   */
  beginStage(stage: TurnStage): () => void {
    const enteredAt = this.#clock.now();
    const previous = this.#currentStage;
    this.#currentStage = stage;

    // One span per stage, so "why was this turn slow?" is a flame graph rather
    // than a log hunt. Spans are opened here rather than at each call site
    // because this is already the one place every stage boundary is known.
    const span = this.#tracer.startSpan(`nexa.turn.${stage}`, { 'nexa.turn_id': this.#turnId });

    let closed = false;
    return () => {
      if (closed) return;
      closed = true;
      this.#stageTimings[stage] = this.#clock.now() - enteredAt;
      this.#currentStage = previous;
      span.end();
    };
  }

  /** Records a port call. Accepts the live result so callers cannot forget to map. */
  recordPortCall<T>(call: PortCall<T>): void {
    this.#portCalls.push(toRecord(call));
  }

  recordPortCalls(calls: readonly PortCall<unknown>[]): void {
    for (const call of calls) this.#portCalls.push(toRecord(call));
  }

  /**
   * Records an already-flattened row.
   *
   * For the paths where the live result is gone — most importantly a failed
   * assembly, where the calls arrive on the error rather than on a return value.
   */
  recordRawPortCall(call: PortCallRecord): void {
    this.#portCalls.push(call);
  }

  recordModelCall(call: ModelCall): void {
    this.#modelCalls.push(call);
  }

  recordDecision(decision: Decision): void {
    this.#decision = decision;
  }

  recordRejection(rejection: {
    readonly actionType: ActionType | 'unknown';
    readonly reason: RejectionReason;
    readonly detail: string;
  }): void {
    this.#rejectedActions.push(rejection);
    this.diagnose(
      'action_rejected',
      'warning',
      `${rejection.actionType} rejected (${rejection.reason}): ${rejection.detail}`,
    );
  }

  /**
   * Records an action the client declared it cannot execute.
   *
   * Kept apart from `recordRejection` because it is not a rejection: the action
   * was well-formed and the generation was correct. What it indicts is the
   * pairing of this companion's repertoire with this client's, which is an
   * operational fact rather than a bug in either.
   */
  recordUnsupported(actionType: ActionType): void {
    this.#rejectedActions.push({
      actionType,
      reason: 'permission',
      detail: 'The client declared it cannot execute this action type.',
    });
    this.diagnose(
      'action_unsupported_by_client',
      'info',
      `${actionType} dropped: not supported by this client.`,
    );
  }

  /**
   * Captures the budget outcome from the assembled context.
   *
   * Copied out rather than holding the context, so the builder never keeps a
   * 10–30k-token object alive for the lifetime of the record.
   */
  recordContext(context: CognitiveContext): void {
    this.#omissions = context.budget.omissions;
    this.#degraded = isDegraded(context.budget);

    for (const omission of context.budget.omissions) {
      // `empty` is not a degradation — a companion with no active goals has
      // nothing missing. Reporting it would drown the signal that matters.
      if (omission.reason === 'empty') continue;
      this.diagnose(
        'context_section_dropped',
        'warning',
        `${omission.section} dropped: ${omission.reason}`,
      );
    }
  }

  /** Points the record at wherever the context was persisted, if it was. */
  recordContextRef(ref: string): void {
    this.#contextRef = ref;
  }

  diagnose(code: DiagnosticCode, severity: DiagnosticSeverity, detail: string): void {
    this.#diagnostics.push({ code, severity, stage: this.#currentStage, detail });
  }

  build(result: {
    readonly outcome: TurnRecord['outcome'];
    readonly actions: readonly Action[];
    readonly failedStage?: TurnStage;
    readonly failureReason?: string;
  }): TurnRecord {
    return {
      turnId: this.#turnId,
      companionId: this.#companionId,
      userId: this.#userId,
      source: this.#source,
      startedAt: timestamp(this.#startedAt),
      durationMs: this.#clock.now() - this.#startedAtMs,
      outcome: result.outcome,
      failedStage: result.failedStage ?? null,
      failureReason: result.failureReason ?? null,
      stageTimings: { ...this.#stageTimings },
      portCalls: [...this.#portCalls],
      modelCalls: [...this.#modelCalls],
      decision: this.#decision,
      actions: [...result.actions],
      rejectedActions: [...this.#rejectedActions],
      degraded: this.#degraded,
      omissions: [...this.#omissions],
      diagnostics: [...this.#diagnostics],
      contextRef: this.#contextRef,
    };
  }
}
