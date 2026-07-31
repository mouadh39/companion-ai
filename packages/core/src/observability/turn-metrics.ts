import type { TurnRecord } from '@nexa/models';
import type { Metrics } from './contracts.js';

/**
 * The metric names Core emits.
 *
 * Constants rather than inline strings, because a dashboard breaks silently
 * when a name is retyped and the only symptom is a panel that stops updating.
 */
export const TURN_METRICS = {
  duration: 'nexa_turn_duration_seconds',
  stageDuration: 'nexa_turn_stage_duration_seconds',
  /**
   * The headline quality signal.
   *
   * Not error rate. A system designed to degrade shows ~0% errors while
   * quietly getting worse; this is the number that tracks whether answers are
   * still good. It counts only turns where something that *should* have arrived
   * did not — see `isDegraded`.
   */
  degraded: 'nexa_turn_degraded_total',
  total: 'nexa_turn_total',
  portDuration: 'nexa_port_duration_seconds',
  modelTokens: 'nexa_model_tokens_total',
  /** A rising ratio here is a prompt regression, visible before the bill is. */
  cacheHitTokens: 'nexa_model_cached_tokens_total',
  // There is deliberately no `toolCalls` counter. Every tool invocation goes
  // through `callPort('tool:<id>')`, so it is already a `portDuration` series
  // carrying both its outcome and its latency — a separate bare count would be
  // a second, thinner source of truth for the same events.
  actionsDropped: 'nexa_actions_dropped_total',
  diagnostics: 'nexa_turn_diagnostics_total',
} as const;

/**
 * Reports one finished turn.
 *
 * Reads the record rather than instrumenting the pipeline in a dozen places,
 * which keeps every measurement consistent with what was actually recorded and
 * means a new stage is measured the moment it is timed.
 *
 * Labels are deliberately low cardinality — never `userId`, never `companionId`,
 * never a message. A metrics backend charges by series, and one label carrying
 * a user id turns a handful of series into one per user.
 */
export const reportTurn = (metrics: Metrics, record: TurnRecord): void => {
  const outcome = { outcome: record.outcome, source: record.source };

  metrics.increment(TURN_METRICS.total, outcome);
  metrics.observe(TURN_METRICS.duration, record.durationMs / 1_000, outcome);

  if (record.degraded) {
    metrics.increment(TURN_METRICS.degraded, { source: record.source });
  }

  for (const [stage, ms] of Object.entries(record.stageTimings)) {
    if (ms === undefined) continue;
    metrics.observe(TURN_METRICS.stageDuration, ms / 1_000, { stage });
  }

  for (const call of record.portCalls) {
    metrics.observe(TURN_METRICS.portDuration, call.durationMs / 1_000, {
      port: call.port,
      outcome: call.outcome,
    });
  }

  for (const call of record.modelCalls) {
    metrics.increment(TURN_METRICS.modelTokens, { model: call.model, kind: 'input' }, call.inputTokens);
    metrics.increment(TURN_METRICS.modelTokens, { model: call.model, kind: 'output' }, call.outputTokens);
    if (call.cachedInputTokens > 0) {
      metrics.increment(
        TURN_METRICS.cacheHitTokens,
        { model: call.model },
        call.cachedInputTokens,
      );
    }
  }

  for (const rejection of record.rejectedActions) {
    metrics.increment(TURN_METRICS.actionsDropped, {
      action: rejection.actionType,
      reason: rejection.reason,
    });
  }

  for (const diagnostic of record.diagnostics) {
    metrics.increment(TURN_METRICS.diagnostics, {
      code: diagnostic.code,
      severity: diagnostic.severity,
      stage: diagnostic.stage,
    });
  }
};
