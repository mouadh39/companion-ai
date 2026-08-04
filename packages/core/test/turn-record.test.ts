import { describe, expect, it } from 'vitest';
import { Deadline, TurnRecordBuilder, callPort } from '@nexa/core';
import {
  confidence,
  defaultBudget,
  defaultPersonality,
  timestamp,
} from '@nexa/models';
import type {
  CognitiveContext,
  ContextBudget,
  Decision,
  Perception,
} from '@nexa/models';
import { FixedClock, trustExternalId } from '@nexa/shared';
import type { CompanionId, DecisionId, TurnId, UserId } from '@nexa/shared';
import { testIdentity } from './fixtures.js';

/**
 * The record is the turn's audit artifact, and these tests hold the one
 * property that makes it worth having: it measures the turn without ever being
 * reachable from the reasoning. Anything here that leaked into
 * `CognitiveContext` would make the same context stop producing the same
 * decision across environments.
 */

const turnId = trustExternalId<TurnId>('00000000-0000-7000-8000-0000000000aa');
const companionId = trustExternalId<CompanionId>('companion-1');
const userId = trustExternalId<UserId>('user-1');

const builder = (clock: FixedClock): TurnRecordBuilder =>
  new TurnRecordBuilder({ clock, turnId, companionId, userId, source: 'user' });

const perception: Perception = {
  text: 'hello',
  intents: [{ kind: 'casual', confidence: confidence(0.9) }],
  entities: [],
  emotion: null,
};

const contextWith = (budget: ContextBudget): CognitiveContext => ({
  turnId,
  companionId,
  userId,
  at: timestamp('2026-07-30T12:00:00.000Z'),
  perception,
  identity: testIdentity(),
  expression: null,
  personality: defaultPersonality(),
  workingMemory: [],
  retrievedMemories: [],
  goals: [],
  availableTools: [],
  emotion: null,
  relationship: null,
  world: null,
  plan: null,
  hint: null,
  budget,
});

const decision: Decision = {
  id: trustExternalId<DecisionId>('decision-1'),
  kind: 'answer',
  confidence: confidence(0.85),
  reasonCodes: ['direct_question'],
  alternatives: [],
  groundedIn: [],
};

describe('TurnRecordBuilder', () => {
  it('carries the turn identity through to the record', () => {
    const record = builder(new FixedClock(1_000)).build({
      outcome: 'completed',
      actions: [],
    });

    expect(record.turnId).toBe(turnId);
    expect(record.companionId).toBe(companionId);
    expect(record.userId).toBe(userId);
    expect(record.source).toBe('user');
    expect(record.outcome).toBe('completed');
  });

  it('times each stage independently', () => {
    const clock = new FixedClock(1_000);
    const record = builder(clock);

    const endPerception = record.beginStage('perception');
    clock.advance(30);
    endPerception();

    const endAssembly = record.beginStage('context_assembly');
    clock.advance(220);
    endAssembly();

    const built = record.build({ outcome: 'completed', actions: [] });

    expect(built.stageTimings.perception).toBe(30);
    expect(built.stageTimings.context_assembly).toBe(220);
    // A stage that never ran has no entry, rather than a zero that would be
    // indistinguishable from a stage that ran instantly.
    expect(built.stageTimings.generation).toBeUndefined();
  });

  it('measures the whole turn separately from its stages', () => {
    const clock = new FixedClock(1_000);
    const record = builder(clock);
    clock.advance(500);

    expect(record.build({ outcome: 'completed', actions: [] }).durationMs).toBe(500);
  });

  it('keeps port calls per call, not per section', async () => {
    const clock = new FixedClock(1_000);
    const record = builder(clock);
    const options = {
      signal: new AbortController().signal,
      deadline: Deadline.after(clock, 1_000),
      turnId,
    };

    record.recordPortCall(await callPort('identity', 100, options, async () => 'id'));
    record.recordPortCall(await callPort('goals', 100, options, async () => []));

    const built = record.build({ outcome: 'completed', actions: [] });

    expect(built.portCalls.map((call) => call.port)).toEqual(['identity', 'goals']);
    expect(built.portCalls.every((call) => call.outcome === 'ok')).toBe(true);
  });

  it('derives degradation from the assembled budget', () => {
    const record = builder(new FixedClock(1_000));
    record.recordContext(
      contextWith({
        ...defaultBudget(),
        omissions: [{ section: 'world', reason: 'port_timeout' }],
      }),
    );

    const built = record.build({ outcome: 'completed', actions: [] });

    expect(built.degraded).toBe(true);
    expect(built.omissions).toEqual([{ section: 'world', reason: 'port_timeout' }]);
  });

  /**
   * An empty section is not a degradation. A companion with no active goals has
   * nothing missing, and reporting it would bury the omissions that matter.
   */
  it('does not raise a diagnostic for a section that was merely empty', () => {
    const record = builder(new FixedClock(1_000));
    record.recordContext(
      contextWith({
        ...defaultBudget(),
        omissions: [
          { section: 'goals', reason: 'empty' },
          { section: 'retrieved_memories', reason: 'budget_exceeded' },
        ],
      }),
    );

    const built = record.build({ outcome: 'completed', actions: [] });
    const dropped = built.diagnostics.filter(
      (diagnostic) => diagnostic.code === 'context_section_dropped',
    );

    expect(dropped).toHaveLength(1);
    expect(dropped[0]?.detail).toContain('retrieved_memories');
  });

  it('records a dropped action instead of losing it', () => {
    const record = builder(new FixedClock(1_000));
    record.recordRejection({
      actionType: 'gesture',
      reason: 'schema',
      detail: 'Unknown gesture kind.',
    });

    const built = record.build({ outcome: 'completed', actions: [] });

    expect(built.rejectedActions).toEqual([
      { actionType: 'gesture', reason: 'schema', detail: 'Unknown gesture kind.' },
    ]);
    expect(built.diagnostics.some((d) => d.code === 'action_rejected')).toBe(true);
  });

  it('attributes a diagnostic to the stage that was open', () => {
    const clock = new FixedClock(1_000);
    const record = builder(clock);

    const endGeneration = record.beginStage('generation');
    record.diagnose('tool_loop_exhausted', 'warning', 'hit 4 iterations');
    endGeneration();

    const built = record.build({ outcome: 'completed', actions: [] });

    expect(built.diagnostics[0]?.stage).toBe('generation');
    expect(built.diagnostics[0]?.severity).toBe('warning');
  });

  it('restores the enclosing stage when a nested one closes', () => {
    const clock = new FixedClock(1_000);
    const record = builder(clock);

    const endGeneration = record.beginStage('generation');
    const endNested = record.beginStage('validation');
    endNested();
    record.diagnose('provider_refused', 'error', 'declined');
    endGeneration();

    expect(record.build({ outcome: 'completed', actions: [] }).diagnostics[0]?.stage).toBe(
      'generation',
    );
  });

  it('keeps the decision that was reached', () => {
    const record = builder(new FixedClock(1_000));
    record.recordDecision(decision);

    expect(record.build({ outcome: 'completed', actions: [] }).decision).toEqual(decision);
  });

  it('records the failing stage and reason on a failed turn', () => {
    const record = builder(new FixedClock(1_000));
    const built = record.build({
      outcome: 'failed',
      actions: [],
      failedStage: 'generation',
      failureReason: 'The model returned an empty response.',
    });

    expect(built.outcome).toBe('failed');
    expect(built.failedStage).toBe('generation');
    expect(built.failureReason).toBe('The model returned an empty response.');
  });

  it('nulls the failure fields on a turn that completed', () => {
    const built = builder(new FixedClock(1_000)).build({
      outcome: 'completed',
      actions: [],
    });

    expect(built.failedStage).toBeNull();
    expect(built.failureReason).toBeNull();
  });

  /**
   * Contexts are 10–30k tokens and only a sampled minority are stored, so the
   * pointer is null by default and the record stays useful without it.
   */
  it('leaves the context pointer null until a context is persisted', () => {
    const record = builder(new FixedClock(1_000));
    expect(record.build({ outcome: 'completed', actions: [] }).contextRef).toBeNull();

    record.recordContextRef('s3://contexts/turn-aa.json');
    expect(record.build({ outcome: 'completed', actions: [] }).contextRef).toBe(
      's3://contexts/turn-aa.json',
    );
  });

  it('snapshots its collections, so a later call cannot mutate an earlier record', () => {
    const record = builder(new FixedClock(1_000));
    const first = record.build({ outcome: 'completed', actions: [] });

    record.diagnose('deadline_exhausted', 'warning', 'no budget left');
    const second = record.build({ outcome: 'completed', actions: [] });

    expect(first.diagnostics).toHaveLength(0);
    expect(second.diagnostics).toHaveLength(1);
  });
});
