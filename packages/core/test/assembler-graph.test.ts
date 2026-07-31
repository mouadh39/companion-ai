import { describe, expect, it } from 'vitest';
import {
  ContextAssembler,
  DECISION_HINT,
  Deadline,
  EMOTION,
  GOALS,
  IDENTITY,
  PERSONALITY,
  RETRIEVED_MEMORIES,
  TOOLS,
  WORKING_MEMORY,
  WORLD,
} from '@nexa/core';
import type { ContextPorts, PortOptions } from '@nexa/core';
import { confidence, defaultPersonality, isDegraded, timestamp } from '@nexa/models';
import type { WorldSnapshot } from '@nexa/models';
import { FixedClock, systemClock, trustExternalId } from '@nexa/shared';
import type { CompanionId, TurnId, UserId } from '@nexa/shared';

/**
 * The shape of the *production* contributor graph.
 *
 * `context-graph.test.ts` proves the scheduler is correct in general; this
 * proves the graph the assembler actually declares is the one intended. It is
 * the check that catches a future contributor added with a forgotten `dependsOn`
 * — which would run in the first wave, read nothing, and fail silently.
 */

const turnId = trustExternalId<TurnId>('00000000-0000-7000-8000-0000000000cc');
const companionId = trustExternalId<CompanionId>('companion-1');
const userId = trustExternalId<UserId>('user-1');

const ports: ContextPorts = {
  identity: {
    load: async () => ({
      name: 'Nexa',
      selfDescription: 'a companion',
      coreValues: ['honesty'],
      version: 1,
    }),
  },
  personality: { load: async () => defaultPersonality() },
  workingMemory: { recent: async () => [], append: async () => undefined },
  memoryRetrieval: { retrieve: async () => [] },
  goals: { active: async () => [] },
  tools: { available: async () => [] },
  tokens: { estimate: (text: string) => Math.ceil(text.length / 4) },
};

const options = (): PortOptions => ({
  signal: new AbortController().signal,
  deadline: Deadline.after(systemClock, 5_000),
  turnId,
});

const assembler = (extra: Partial<ContextPorts> = {}): ContextAssembler =>
  new ContextAssembler(
    { ...ports, ...extra },
    new FixedClock(Date.parse('2026-07-30T12:00:00.000Z')),
  );

const perception = {
  text: 'where are my keys',
  intents: [{ kind: 'question' as const, confidence: confidence(0.9) }],
  entities: ['keys'],
  emotion: null,
};

const assemble = async (extra: Partial<ContextPorts> = {}) =>
  assembler(extra).assemble({ turnId, companionId, userId, perception, options: options() });

const worldSnapshot: WorldSnapshot = {
  objects: [],
  currentSpace: null,
  observedAt: timestamp('2026-07-30T11:59:00.000Z'),
  stale: false,
};

describe('the assembler’s declared graph', () => {
  it('resolves in exactly two waves', () => {
    expect(assembler().waves).toHaveLength(2);
  });

  it('runs everything independent concurrently in the first wave', () => {
    const first = assembler().waves[0]?.map((c) => c.key.id).sort();

    expect(first).toEqual([GOALS.id, IDENTITY.id, PERSONALITY.id, TOOLS.id, WORKING_MEMORY.id]);
  });

  /**
   * The one real edge: a memory's relevance depends on what the companion is
   * currently trying to do. Previously this lived in the order of two
   * statements, which also meant goals could not run alongside identity.
   */
  it('defers only retrieval, and only behind goals', () => {
    const graph = assembler().waves;

    expect(graph[1]?.map((c) => c.key.id)).toEqual([RETRIEVED_MEMORIES.id]);
    expect(graph[1]?.[0]?.dependsOn.map((d) => d.id)).toEqual([GOALS.id]);
  });

  it('marks identity and personality required, and nothing else', () => {
    const required = assembler()
      .waves.flat()
      .filter((contribution) => contribution.required)
      .map((contribution) => contribution.key.id)
      .sort();

    expect(required).toEqual([IDENTITY.id, PERSONALITY.id]);
  });

  it('still produces a usable context through the graph', async () => {
    const { context, portCalls } = await assemble();

    expect(context.identity.name).toBe('Nexa');
    expect(context.turnId).toBe(turnId);
    // One call per contributor, so the record can attribute assembly latency.
    expect(portCalls).toHaveLength(6);
    expect(portCalls.every((call) => call.outcome === 'ok')).toBe(true);
  });
});

describe('capabilities that are not composed in', () => {
  it('leaves their sections null', async () => {
    const { context } = await assemble();

    expect(context.world).toBeNull();
    expect(context.plan).toBeNull();
    expect(context.hint).toBeNull();
  });

  it('contributes no calls', async () => {
    const { portCalls } = await assemble();
    expect(portCalls.map((call) => call.port)).not.toContain(WORLD.id);
  });

  /**
   * The distinction M4 turns on. A companion with no world model is not a
   * degraded companion — it has no such faculty. Recording an omission would
   * mark every turn degraded until every engine ships, and `degraded` is the
   * one metric that tracks quality in a system built to fail quietly.
   */
  it('does not mark the turn degraded', async () => {
    const { context } = await assemble();

    const sections = context.budget.omissions.map((omission) => omission.section);
    expect(sections).not.toContain('world');
    expect(sections).not.toContain('emotion');
    expect(sections).not.toContain('relationship');
    expect(isDegraded(context.budget)).toBe(false);
  });
});

describe('capabilities that are composed in', () => {
  it('joins independent ones to the first wave', () => {
    const graph = assembler({
      world: { snapshot: async () => worldSnapshot },
      emotion: { current: async () => null },
    }).waves;

    expect(graph[0]?.map((c) => c.key.id).sort()).toContain(WORLD.id);
    expect(graph).toHaveLength(2);
  });

  it('populates the section it owns', async () => {
    const { context } = await assemble({ world: { snapshot: async () => worldSnapshot } });

    expect(context.world).toEqual(worldSnapshot);
  });

  /** Composed and failing *is* degradation — unlike composed and absent. */
  it('records an omission when one fails', async () => {
    const { context } = await assemble({
      world: { snapshot: () => Promise.reject(new Error('world model down')) },
    });

    expect(context.world).toBeNull();
    expect(context.budget.omissions).toContainEqual({
      section: 'world',
      reason: 'port_error',
    });
    expect(isDegraded(context.budget)).toBe(true);
  });

  it('records an empty reading separately from a failed one', async () => {
    const { context } = await assemble({ emotion: { current: async () => null } });

    expect(context.budget.omissions).toContainEqual({
      section: 'emotion',
      reason: 'empty',
    });
  });
});

describe('the decision advisor', () => {
  const advisor = {
    advise: async () => ({
      suggested: 'answer' as const,
      confidence: confidence(0.9),
      source: 'test',
      reasonCodes: [],
    }),
  };

  /**
   * The advisor consumes the rest of the context, so it lands last by
   * construction rather than by someone remembering to put it there.
   */
  it('runs in a wave after everything it reads', () => {
    const graph = assembler({ decisionAdvisor: advisor }).waves;
    const last = graph[graph.length - 1];

    expect(last?.map((c) => c.key.id)).toEqual([DECISION_HINT.id]);
    expect(last?.[0]?.dependsOn.map((d) => d.id).sort()).toEqual(
      [GOALS.id, RETRIEVED_MEMORIES.id, WORKING_MEMORY.id].sort(),
    );
  });

  it('waits on the optional sections it reads, when they exist', () => {
    const graph = assembler({
      decisionAdvisor: advisor,
      world: { snapshot: async () => worldSnapshot },
      emotion: { current: async () => null },
    }).waves;

    const hint = graph[graph.length - 1]?.[0];
    expect(hint?.dependsOn.map((d) => d.id)).toContain(WORLD.id);
    expect(hint?.dependsOn.map((d) => d.id)).toContain(EMOTION.id);
  });

  it('lands its opinion on the context', async () => {
    const { context } = await assemble({ decisionAdvisor: advisor });

    expect(context.hint?.suggested).toBe('answer');
    expect(context.hint?.source).toBe('test');
  });

  it('is given what the earlier waves produced', async () => {
    let sawPerception: string | undefined;
    await assemble({
      decisionAdvisor: {
        advise: async (request) => {
          sawPerception = request.perception.text;
          return null;
        },
      },
    });

    expect(sawPerception).toBe('where are my keys');
  });

  /** A failed advisor costs a hint, never the turn. */
  it('degrades to no hint when it fails', async () => {
    const { context } = await assemble({
      decisionAdvisor: { advise: () => Promise.reject(new Error('advisor down')) },
    });

    expect(context.hint).toBeNull();
  });
});
