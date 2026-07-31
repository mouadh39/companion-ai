import { describe, expect, it } from 'vitest';
import {
  RecordingLogger,
  RecordingMetrics,
  TURN_METRICS,
  reportTurn,
} from '@nexa/core';
import { confidence, timestamp } from '@nexa/models';
import type { TurnRecord } from '@nexa/models';
import { trustExternalId } from '@nexa/shared';
import type { CompanionId, DecisionId, TurnId, UserId } from '@nexa/shared';

/**
 * Metrics are read off the record rather than emitted from a dozen points in
 * the pipeline. That keeps every measurement consistent with what was actually
 * recorded, and means a new stage becomes visible the moment it is timed rather
 * than when someone remembers to instrument it.
 */

const record = (over: Partial<TurnRecord> = {}): TurnRecord => ({
  turnId: trustExternalId<TurnId>('turn-1'),
  companionId: trustExternalId<CompanionId>('companion-1'),
  userId: trustExternalId<UserId>('user-1'),
  source: 'user',
  startedAt: timestamp('2026-07-30T12:00:00.000Z'),
  durationMs: 1_500,
  outcome: 'completed',
  failedStage: null,
  failureReason: null,
  stageTimings: {},
  portCalls: [],
  modelCalls: [],
  decision: null,
  actions: [],
  rejectedActions: [],
  degraded: false,
  omissions: [],
  diagnostics: [],
  contextRef: null,
  ...over,
});

describe('reportTurn', () => {
  it('counts the turn and its duration', () => {
    const metrics = new RecordingMetrics();
    reportTurn(metrics, record());

    expect(metrics.named(TURN_METRICS.total)).toHaveLength(1);
    expect(metrics.named(TURN_METRICS.duration)[0]?.value).toBe(1.5);
  });

  /**
   * The headline quality signal. A system built to degrade shows ~0% errors
   * while quietly getting worse, so this is the number that tracks whether
   * answers are still good.
   */
  it('counts a degraded turn only when something was lost', () => {
    const clean = new RecordingMetrics();
    reportTurn(clean, record({ degraded: false }));
    expect(clean.named(TURN_METRICS.degraded)).toHaveLength(0);

    const thin = new RecordingMetrics();
    reportTurn(thin, record({ degraded: true }));
    expect(thin.named(TURN_METRICS.degraded)).toHaveLength(1);
  });

  it('labels stage durations by stage', () => {
    const metrics = new RecordingMetrics();
    reportTurn(
      metrics,
      record({ stageTimings: { perception: 30, context_assembly: 220 } }),
    );

    const stages = metrics.named(TURN_METRICS.stageDuration);
    expect(stages).toHaveLength(2);
    expect(stages.map((m) => m.labels['stage']).sort()).toEqual([
      'context_assembly',
      'perception',
    ]);
  });

  it('reports every port call with its outcome', () => {
    const metrics = new RecordingMetrics();
    reportTurn(
      metrics,
      record({
        portCalls: [
          { port: 'identity', outcome: 'ok', durationMs: 5 },
          { port: 'world', outcome: 'timeout', durationMs: 150 },
        ],
      }),
    );

    const calls = metrics.named(TURN_METRICS.portDuration);
    expect(calls).toHaveLength(2);
    expect(calls[1]?.labels).toEqual({ port: 'world', outcome: 'timeout' });
  });

  it('splits model tokens by direction', () => {
    const metrics = new RecordingMetrics();
    reportTurn(
      metrics,
      record({
        modelCalls: [
          {
            model: 'claude-opus-5',
            inputTokens: 900,
            outputTokens: 120,
            cachedInputTokens: 0,
            latencyMs: 800,
            refused: false,
          },
        ],
      }),
    );

    const tokens = metrics.named(TURN_METRICS.modelTokens);
    expect(tokens).toHaveLength(2);
    expect(tokens.find((m) => m.labels['kind'] === 'input')?.value).toBe(900);
    expect(tokens.find((m) => m.labels['kind'] === 'output')?.value).toBe(120);
  });

  /** Without this, a prompt reordering that defeats the cache shows up as a bill. */
  it('reports cached tokens only when the cache was hit', () => {
    const cold = new RecordingMetrics();
    reportTurn(
      cold,
      record({
        modelCalls: [
          {
            model: 'm',
            inputTokens: 10,
            outputTokens: 1,
            cachedInputTokens: 0,
            latencyMs: 1,
            refused: false,
          },
        ],
      }),
    );
    expect(cold.named(TURN_METRICS.cacheHitTokens)).toHaveLength(0);

    const warm = new RecordingMetrics();
    reportTurn(
      warm,
      record({
        modelCalls: [
          {
            model: 'm',
            inputTokens: 10,
            outputTokens: 1,
            cachedInputTokens: 800,
            latencyMs: 1,
            refused: false,
          },
        ],
      }),
    );
    expect(warm.named(TURN_METRICS.cacheHitTokens)[0]?.value).toBe(800);
  });

  it('counts dropped actions by reason', () => {
    const metrics = new RecordingMetrics();
    reportTurn(
      metrics,
      record({
        rejectedActions: [
          { actionType: 'gesture', reason: 'permission', detail: 'unsupported' },
        ],
      }),
    );

    expect(metrics.named(TURN_METRICS.actionsDropped)[0]?.labels).toEqual({
      action: 'gesture',
      reason: 'permission',
    });
  });

  it('counts diagnostics by code, so a code can be alerted on', () => {
    const metrics = new RecordingMetrics();
    reportTurn(
      metrics,
      record({
        diagnostics: [
          {
            code: 'tool_loop_exhausted',
            severity: 'warning',
            stage: 'generation',
            detail: 'hit 4 rounds',
          },
        ],
      }),
    );

    expect(metrics.named(TURN_METRICS.diagnostics)[0]?.labels).toEqual({
      code: 'tool_loop_exhausted',
      severity: 'warning',
      stage: 'generation',
    });
  });

  /**
   * A metrics backend charges by series. One label carrying a user id turns a
   * handful of series into one per user.
   */
  it('never labels a metric with a user or companion', () => {
    const metrics = new RecordingMetrics();
    reportTurn(
      metrics,
      record({
        decision: {
          id: trustExternalId<DecisionId>('d1'),
          kind: 'answer',
          confidence: confidence(0.9),
          reasonCodes: ['direct_question'],
          alternatives: [],
          groundedIn: [],
        },
        stageTimings: { generation: 10 },
        portCalls: [{ port: 'identity', outcome: 'ok', durationMs: 1 }],
      }),
    );

    const values = metrics.recorded.flatMap((m) => Object.values(m.labels));
    expect(values).not.toContain('user-1');
    expect(values).not.toContain('companion-1');
    expect(values).not.toContain('turn-1');
  });
});

describe('RecordingLogger', () => {
  it('merges bound fields into every line', () => {
    const logger = new RecordingLogger();
    const scoped = logger.child({ turnId: 'turn-1' });

    scoped.log('info', 'turn completed', { durationMs: 12 });

    expect(logger.recorded[0]).toEqual({
      level: 'info',
      message: 'turn completed',
      fields: { turnId: 'turn-1', durationMs: 12 },
    });
  });

  it('lets a child add to what its parent bound', () => {
    const logger = new RecordingLogger();
    logger.child({ a: 1 }).child({ b: 2 }).log('warn', 'nested');

    expect(logger.recorded[0]?.fields).toEqual({ a: 1, b: 2 });
  });
});
