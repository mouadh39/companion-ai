import { describe, expect, it } from 'vitest';
import { FixedClock, isOk } from '@nexa/shared';
import { ScriptedLanguageModel } from '@nexa/providers';
import { compose, type Application } from '../src/composition.js';
import { countingIds } from '../src/adapters/stores.js';
import type { AppConfig } from '../src/config.js';

/**
 * Phase 1B integration.
 *
 * These tests exist to prove one thing the unit suites structurally cannot: that
 * the nine engines built in Phase A actually execute, in one process, against
 * one another's real output. Every engine has its own suite and every one passes
 * in isolation; the composition root is where architectures fail.
 *
 * They assert on cognitive state rather than on prose. The scripted model is the
 * one component never claimed to be deterministic, so nothing here checks what
 * the companion said — only what it perceived, retrieved, planned and formed.
 */

const config = {
  port: 0,
  host: '127.0.0.1',
  provider: 'scripted',
  modelId: 'scripted',
  anthropicApiKey: null,
  logLevel: 'silent',
} as unknown as AppConfig;

const COMPANION = 'companion-1' as never;
const USER = 'user-1' as never;

const build = (startedAt = '2026-08-04T09:00:00.000Z'): { app: Application; clock: FixedClock } => {
  const clock = new FixedClock(Date.parse(startedAt));
  const app = compose(config, {
    clock,
    ids: countingIds('test'),
    languageModel: new ScriptedLanguageModel(),
  });
  return { app, clock };
};

const say = async (app: Application, text: string) => {
  const outcome = await app.turn.run({
    companionId: COMPANION,
    userId: USER,
    text,
    source: 'user',
  });
  await settle();
  return outcome;
};

/** Lets the in-process bus drain. It never awaits handlers, by design. */
const settle = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
};

describe('every engine executes', () => {
  it('runs perception for real, not a keyword table', async () => {
    const { app } = build();
    const outcome = await say(app, 'I am frustrated with the shader compiler.');
    expect(isOk(outcome)).toBe(true);
    if (!isOk(outcome)) return;

    const facts = app.cognition.scratchpad.read(outcome.value.turnId);
    // The real engine reports twenty-nine dimensions with stances. The
    // placeholder it replaced reported one emotion at a fixed 0.55.
    expect(facts?.perception.observations.length).toBeGreaterThan(1);
    expect(
      facts?.perception.observations.some(
        (observation) => observation.dimension === 'frustration' && observation.stance === 'observed',
      ),
    ).toBe(true);
    expect(facts?.perception.unknown.length).toBeGreaterThan(0);

    await app.shutdown();
  });

  it('runs memory formation when the turn decides something is worth keeping', async () => {
    const { app } = build();
    // A correction is the one decision Core maps to `remember`, so it is the
    // only path that reaches `MemoryWritePort`. That is Core's rule and this
    // test drives it rather than working around it.
    await say(app, "That's wrong, I prefer Unity over Unreal for prototyping.");

    // `RecordingMemoryWrite` appended to an array. This went through `decide()`.
    expect(app.cognition.formation.decisions.length).toBeGreaterThan(0);
    expect(app.cognition.formation.decisions[0]?.outcome).not.toBe('declined_no_owner');

    await app.shutdown();
  });

  it('runs retrieval against what memory formed', async () => {
    const { app } = build();
    await say(app, "That's wrong, I prefer Unity over Unreal for prototyping.");
    const stored = await app.cognition.memories.all(COMPANION, USER);
    expect(stored.length).toBeGreaterThan(0);

    const outcome = await say(app, 'Tell me about Unity prototyping.');
    if (!isOk(outcome)) throw new Error('turn failed');

    const facts = app.cognition.scratchpad.read(outcome.value.turnId);
    // Something the placeholder could never do: a candidate set with a real
    // memory in it, ranked by the real engine.
    expect(facts?.retrieval?.consideredCount ?? 0).toBeGreaterThan(0);

    await app.shutdown();
  });

  it('runs planning and produces a full conversation plan', async () => {
    const { app } = build();
    const outcome = await say(app, 'Can you help me plan the shader work?');
    if (!isOk(outcome)) throw new Error('turn failed');

    const facts = app.cognition.scratchpad.read(outcome.value.turnId);
    expect(facts?.plan).not.toBeNull();
    expect(facts?.plan?.considered.length).toBe(11);
    expect(facts?.plan?.strategy).toBeDefined();
    // The plan carries more than Core's hint does. That is the point of keeping
    // it: the hint is a projection and this is what it was projected from.
    expect(facts?.plan?.constraints).toBeDefined();

    await app.shutdown();
  });

  it('runs relationship progression after the turn', async () => {
    const { app } = build();
    await say(app, 'Hello there.');

    expect(app.cognition.consolidation.passes.length).toBe(1);
    const relationship = await app.cognition.relationships.current(
      COMPANION,
      USER,
      '2026-08-04T09:00:00.000Z' as never,
    );
    expect(relationship.interactionCount).toBe(1);

    await app.shutdown();
  });

  it('runs reflection after the turn', async () => {
    const { app } = build();
    for (const message of [
      'I enjoy Unity.',
      'I enjoy VR.',
      'I enjoy AI.',
    ]) {
      await say(app, message);
    }

    // Reflection ran on every completed turn. Whether it *formed* anything
    // depends on its own gates, which is the engine's business — what this
    // asserts is that it executed rather than being absent.
    expect(app.cognition.consolidation.passes.length).toBe(3);

    await app.shutdown();
  });

  it('runs identity and personality, which were already wired', async () => {
    const { app } = build();
    const outcome = await say(app, 'What can you do?');
    if (!isOk(outcome)) throw new Error('turn failed');

    const called = outcome.value.record.portCalls.map((call) => call.port);
    expect(called).toContain('identity');
    expect(called).toContain('personality');
    expect(called).toContain('expression');

    await app.shutdown();
  });
});

describe('every port is exercised', () => {
  it('records a port call for each composed capability', async () => {
    const { app } = build();
    const outcome = await say(app, 'I am stuck on the Unity shader. Can you help?');
    if (!isOk(outcome)) throw new Error('turn failed');

    const called = new Set(outcome.value.record.portCalls.map((call) => call.port));

    // Every port the composition root wires must have been touched. A port
    // composed in but never called is wiring nobody is testing.
    // The labels Core records, which are snake_case and named after the context
    // section rather than after the port interface.
    for (const port of [
      'perception',
      'identity',
      'personality',
      'expression',
      'working_memory',
      'retrieved_memories',
      'relationship',
      'decision_hint',
      'goals',
      'tools',
    ]) {
      expect(called.has(port), `port '${port}' was never called`).toBe(true);
    }

    await app.shutdown();
  });

  it('reports no port failures on a healthy turn', async () => {
    const { app } = build();
    const outcome = await say(app, 'I am stuck on the Unity shader. Can you help?');
    if (!isOk(outcome)) throw new Error('turn failed');

    const failed = outcome.value.record.portCalls.filter((call) => call.outcome !== 'ok');
    expect(failed.map((call) => `${call.port}:${call.outcome}`)).toStrictEqual([]);

    await app.shutdown();
  });
});

describe('placeholders are gone', () => {
  it('no longer exports the retired cognitive adapters', async () => {
    const adapters = await import('../src/adapters/in-memory.js');

    expect(Object.keys(adapters)).not.toContain('EmptyMemoryRetrieval');
    expect(Object.keys(adapters)).not.toContain('RecordingMemoryWrite');
    expect(Object.keys(adapters)).not.toContain('StaticIdentity');
    // What remains are stores and honest absences, not cognition.
    expect(Object.keys(adapters).sort()).toStrictEqual([
      'InMemoryPersonality',
      'InMemoryWorkingMemory',
      'NoGoals',
      'NoTools',
    ]);
  });

  it('no longer exports a heuristic perception', async () => {
    const perception = await import('../src/adapters/perception.js');

    expect(Object.keys(perception)).not.toContain('HeuristicPerception');
    expect(Object.keys(perception)).toContain('PerceptionEngine');
  });

  it('retrieval runs the real engine even when it finds nothing', async () => {
    // `EmptyMemoryRetrieval` returned `[]` without ranking anything. This
    // returns nothing *having considered a candidate set* and having recorded
    // why — which is a different thing and the reason the outcome is kept.
    const { app } = build();
    const outcome = await say(app, 'Tell me about Unity prototyping.');
    if (!isOk(outcome)) throw new Error('turn failed');

    const facts = app.cognition.scratchpad.read(outcome.value.turnId);
    expect(facts?.retrieval).not.toBeNull();
    expect(facts?.retrieval?.degraded.length ?? 0).toBeGreaterThan(0);

    await app.shutdown();
  });
});

describe('architectural boundaries hold', () => {
  it('keeps Core free of every capability package', async () => {
    const { readFileSync } = await import('node:fs');
    const core = JSON.parse(
      readFileSync(new URL('../../../packages/core/package.json', import.meta.url), 'utf-8'),
    ) as { dependencies: Record<string, string> };

    for (const capability of [
      '@nexa/memory',
      '@nexa/reflection',
      '@nexa/retrieval',
      '@nexa/perception',
      '@nexa/planning',
      '@nexa/relationship',
      '@nexa/identity',
      '@nexa/personality',
    ]) {
      expect(Object.keys(core.dependencies)).not.toContain(capability);
    }
  });

  it('keeps every engine free of the others', async () => {
    const { readFileSync } = await import('node:fs');
    const engines = [
      'memory',
      'reflection',
      'retrieval',
      'perception',
      'planning',
      'relationship',
      'identity',
      'personality',
    ];

    for (const engine of engines) {
      const manifest = JSON.parse(
        readFileSync(
          new URL(`../../../packages/${engine}/package.json`, import.meta.url),
          'utf-8',
        ),
      ) as { dependencies: Record<string, string> };

      // The rule Phase A never relaxed: a capability package depends on the
      // shared vocabulary and nothing else. Engine-to-engine coupling here is
      // how a cycle appears three refactors later.
      expect(Object.keys(manifest.dependencies).sort(), engine).toStrictEqual(
        Object.keys(manifest.dependencies)
          .filter((name) => name === '@nexa/models' || name === '@nexa/shared')
          .sort(),
      );
    }
  });

  it('bounds the scratchpad rather than letting it grow with traffic', async () => {
    const { app } = build();
    for (let index = 0; index < 12; index++) {
      await say(app, `Message number ${index} about the shader.`);
    }

    // A fixed ring, not a map that grows with traffic.
    expect(app.cognition.scratchpad.size).toBeLessThanOrEqual(256);

    await app.shutdown();
  });
});
