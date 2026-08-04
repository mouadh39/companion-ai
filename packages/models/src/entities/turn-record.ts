import type { CompanionId, TurnId, UserId } from '@nexa/shared';
import type { Action, ActionType, RejectionReason } from './action.js';
import type { Decision } from './decision.js';
import type { SectionOmission } from './context.js';
import type { Timestamp } from '../value-objects/timestamp.js';

/**
 * The stages of one cognitive turn, in execution order.
 *
 * Lives here rather than in `@nexa/events` because three packages need to name
 * a stage and only one of them is about events: the event catalogue reports
 * which stage failed, `@nexa/core` dispatches on it, and the turn record keys
 * its timings by it. Domain vocabulary shared by several layers belongs at the
 * bottom, which is this package.
 */
export type TurnStage =
  | 'admission'
  | 'ingress'
  | 'perception'
  | 'context_assembly'
  | 'deliberation'
  | 'plan_revision'
  | 'generation'
  | 'validation'
  | 'commit'
  | 'publish';

export const TURN_STAGES = [
  'admission',
  'ingress',
  'perception',
  'context_assembly',
  'deliberation',
  'plan_revision',
  'generation',
  'validation',
  'commit',
  'publish',
] as const satisfies readonly TurnStage[];

/**
 * What caused a turn to run.
 *
 * `scheduled` and `autonomous` are separated because they differ in a way that
 * matters operationally: nobody is waiting on either, but a scheduled turn was
 * asked for and an autonomous one was the companion's own idea. Conflating them
 * makes "why did it speak?" unanswerable from the record.
 */
export type TurnSource = 'user' | 'autonomous' | 'scheduled';

export const TURN_SOURCES = [
  'user',
  'autonomous',
  'scheduled',
] as const satisfies readonly TurnSource[];

/**
 * How a single port call ended.
 *
 * `not_attempted` is distinct from `timeout` on purpose — see `OmissionReason`
 * in `context.ts` for why that distinction earns its place.
 */
export type PortOutcome = 'ok' | 'timeout' | 'error' | 'not_attempted' | 'aborted';

export const PORT_OUTCOMES = [
  'ok',
  'timeout',
  'error',
  'not_attempted',
  'aborted',
] as const satisfies readonly PortOutcome[];

/**
 * One port call, as kept in the record.
 *
 * Per *call* rather than per section, because a section can be dropped for a
 * reason that has nothing to do with the port that fed it — a memory section
 * lost to `budget_exceeded` came from a port that answered perfectly well, and
 * only this row can tell you that.
 */
export interface PortCallRecord {
  readonly port: string;
  readonly outcome: PortOutcome;
  readonly durationMs: number;
}

/**
 * Something the turn should say about itself that is not a failure.
 *
 * Coded rather than free text, because operational tooling aggregates on codes
 * and cannot aggregate on sentences. The prose goes in `detail`, where it is
 * read by a human who has already been alerted by the code.
 */
export type DiagnosticCode =
  /** The tool loop hit its iteration ceiling with work outstanding. */
  | 'tool_loop_exhausted'
  /** The tool loop stopped because the turn ran out of time. */
  | 'tool_loop_deadline'
  /** The model cannot do something the pipeline wanted; the stage was skipped. */
  | 'model_capability_missing'
  /** The primary model failed and a fallback served the request. */
  | 'provider_fallback'
  /** The provider declined on policy grounds rather than failing. */
  | 'provider_refused'
  /** An action failed validation and was dropped. */
  | 'action_rejected'
  /** An action was well-formed but the client cannot render it. */
  | 'action_unsupported_by_client'
  /** A context section did not make it into the prompt. */
  | 'context_section_dropped'
  /** A stage was entered with no budget left. */
  | 'deadline_exhausted';

export const DIAGNOSTIC_CODES = [
  'tool_loop_exhausted',
  'tool_loop_deadline',
  'model_capability_missing',
  'provider_fallback',
  'provider_refused',
  'action_rejected',
  'action_unsupported_by_client',
  'context_section_dropped',
  'deadline_exhausted',
] as const satisfies readonly DiagnosticCode[];

/**
 * `warning` is the interesting one: the turn succeeded but produced a worse
 * answer than it should have. That is the class of failure a system designed to
 * degrade will otherwise never report.
 */
export type DiagnosticSeverity = 'info' | 'warning' | 'error';

export interface Diagnostic {
  readonly code: DiagnosticCode;
  readonly severity: DiagnosticSeverity;
  readonly stage: TurnStage;
  readonly detail: string;
}

/**
 * One request to a model provider.
 *
 * Plural on the record because the tool loop makes several. Cost is not stored
 * here and is not stored on the record either: it is a function of these counts
 * and a price table that changes independently of them, so a stored figure goes
 * silently wrong the first time a provider reprices. Derive it at query time.
 */
export interface ModelCall {
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  /** Prompt tokens served from the provider's cache. The prompt-caching signal. */
  readonly cachedInputTokens: number;
  readonly latencyMs: number;
  readonly refused: boolean;
}

/** An action that was generated and then dropped, with the reason it was. */
export interface RejectedActionRecord {
  readonly actionType: ActionType | 'unknown';
  readonly reason: RejectionReason;
  readonly detail: string;
}

export type TurnOutcome = 'completed' | 'failed' | 'aborted';

/**
 * The complete audit artifact for one turn.
 *
 * Deliberately **not** part of `CognitiveContext`, and the separation is the
 * point. Everything here is a *measurement of* the turn — timings, token
 * counts, retries, diagnostics. If any of it were reachable from the context,
 * it would be an input to `deliberate()`, and the same context would stop
 * producing the same decision across environments where those measurements
 * differ. Purity is worth the second object.
 *
 * Nothing that reasons ever reads this. It exists for explaining, alerting,
 * and replaying after the fact.
 */
export interface TurnRecord {
  readonly turnId: TurnId;
  readonly companionId: CompanionId;
  readonly userId: UserId;
  readonly source: TurnSource;

  readonly startedAt: Timestamp;
  readonly durationMs: number;
  readonly outcome: TurnOutcome;
  /** The stage that ended the turn, or null when it completed. */
  readonly failedStage: TurnStage | null;
  readonly failureReason: string | null;

  /** Wall time per stage. Keyed by `TurnStage`, so the histogram labels itself. */
  readonly stageTimings: Readonly<Partial<Record<TurnStage, number>>>;
  readonly portCalls: readonly PortCallRecord[];
  readonly modelCalls: readonly ModelCall[];

  readonly decision: Decision | null;
  readonly actions: readonly Action[];
  /**
   * Dropped actions. Recorded rather than discarded: validation already drops
   * malformed actions silently, and without this row a client that never
   * gestures is indistinguishable from a companion that never gestures.
   */
  readonly rejectedActions: readonly RejectedActionRecord[];

  readonly degraded: boolean;
  readonly omissions: readonly SectionOmission[];
  readonly diagnostics: readonly Diagnostic[];

  /**
   * Where the `CognitiveContext` for this turn was stored, when it was.
   *
   * A pointer rather than the context itself, because contexts are 10–30k
   * tokens and storing every one is the largest storage line in the system.
   * Sampling policy decides which turns keep theirs; the rest carry null and
   * remain fully useful for everything except replay.
   */
  readonly contextRef: string | null;
}
