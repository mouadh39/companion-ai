import { afterAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { FixedClock } from '@nexa/shared';
import { ScriptedLanguageModel } from '@nexa/providers';
import { compose, type Application } from '../src/composition.js';
import type { AppConfig } from '../src/config.js';

/**
 * Memory that survives the process.
 *
 * These are the only tests in the suite that need a database, so they skip
 * themselves when `DATABASE_URL` is absent — a contributor with no Postgres
 * still gets a green run, and CI opts in by setting the variable. Skipping
 * loudly beats a suite that silently proves nothing.
 *
 * "Restart" here means a fresh `Application` with a fresh pool, composed after
 * the previous one was shut down. That is the same thing the process does on
 * boot: nothing is carried in a closure, so anything that survives survived in
 * Postgres.
 *
 * Every run scopes itself to a unique companion id and deletes its own rows
 * afterwards, so this never touches data it did not create.
 */

const DATABASE_URL = process.env['DATABASE_URL'] ?? '';
const describeIfDb = DATABASE_URL === '' ? describe.skip : describe;

const COMPANION = `p04-test-${Date.now()}-${Math.floor(Math.random() * 1e6)}` as never;
const USER_A = 'persist-user-a' as never;
const USER_B = 'persist-user-b' as never;

const config = {
  port: 0,
  host: '127.0.0.1',
  provider: 'scripted',
  modelId: 'scripted',
  anthropicApiKey: null,
  groqApiKey: null,
  providerTimeoutMs: 30_000,
  logLevel: 'silent',
  databaseUrl: DATABASE_URL,
} as unknown as AppConfig;

/** A fresh process, as far as the application is concerned. */
const boot = (): Application =>
  compose(config, {
    clock: new FixedClock(Date.parse('2026-08-04T09:00:00.000Z')),
    languageModel: new ScriptedLanguageModel(),
  });

const sayAs = async (app: Application, userId: never, text: string): Promise<void> => {
  await app.turn.run({ companionId: COMPANION, userId, text, source: 'user' });
  await settle();
};

/**
 * Lets the post-turn bus drain.
 *
 * Consolidation is fire-and-forget by design — the user is answered before
 * reflection and relationship progression run — so a test that reads their
 * output has to wait for it. Against a remote database each pass is several
 * round trips, and the few milliseconds that suffice for an in-memory store
 * are nowhere near enough here.
 */
const settle = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 3_000));
};

const REMEMBERABLE = "That's wrong, I prefer Unity over Unreal for prototyping.";

afterAll(async () => {
  if (DATABASE_URL === '') return;
  const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  try {
    for (const table of ['memories', 'insights', 'relationships', 'conversation_turns']) {
      await pool.query(`delete from ${table} where companion_id = $1`, [COMPANION]);
    }
  } finally {
    await pool.end();
  }
});

describeIfDb('memory survives a restart', () => {
  it('A: what one user stored is still theirs in a new process', async () => {
    const first = boot();
    await sayAs(first, USER_A, REMEMBERABLE);
    const beforeRestart = await first.cognition.memories.all(COMPANION, USER_A);
    expect(beforeRestart.length).toBeGreaterThan(0);
    await first.shutdown();

    // ── restart ──
    const second = boot();
    const afterRestart = await second.cognition.memories.all(COMPANION, USER_A);

    expect(afterRestart.length).toBe(beforeRestart.length);
    expect(afterRestart.map((memory) => memory.content)).toEqual(
      beforeRestart.map((memory) => memory.content),
    );
    expect(afterRestart.every((memory) => memory.userId === USER_A)).toBe(true);
    expect(afterRestart.every((memory) => memory.companionId === COMPANION)).toBe(true);
    await second.shutdown();
  }, 60_000);

  it('B: a different user under the same companion sees none of it after restart', async () => {
    const app = boot();
    const forB = await app.cognition.memories.all(COMPANION, USER_B);
    expect(forB).toEqual([]);
    await app.shutdown();
  }, 60_000);

  it('C: both users keep separate memories across a restart', async () => {
    const first = boot();
    await sayAs(first, USER_B, "That's wrong, I prefer Godot over Unreal for prototyping.");
    await first.shutdown();

    const second = boot();
    const forA = await second.cognition.memories.all(COMPANION, USER_A);
    const forB = await second.cognition.memories.all(COMPANION, USER_B);

    expect(forA.length).toBeGreaterThan(0);
    expect(forB.length).toBeGreaterThan(0);
    expect(forA.every((memory) => memory.userId === USER_A)).toBe(true);
    expect(forB.every((memory) => memory.userId === USER_B)).toBe(true);

    const idsA = new Set(forA.map((memory) => memory.id));
    expect(forB.some((memory) => idsA.has(memory.id))).toBe(false);
    await second.shutdown();
  }, 60_000);

  it('D: formation compares against the owner\'s memories, not everyone\'s', async () => {
    // B restating their own preference must not reinforce or supersede A's row.
    const before = boot();
    const aBefore = await before.cognition.memories.all(COMPANION, USER_A);
    await before.shutdown();

    const during = boot();
    await sayAs(during, USER_B, "That's wrong, I prefer Godot over Unreal for prototyping.");
    await during.shutdown();

    const after = boot();
    const aAfter = await after.cognition.memories.all(COMPANION, USER_A);

    expect(aAfter.map((memory) => memory.id)).toEqual(aBefore.map((memory) => memory.id));
    expect(aAfter.map((memory) => memory.reinforcementCount)).toEqual(
      aBefore.map((memory) => memory.reinforcementCount),
    );
    await after.shutdown();
  }, 60_000);

  it('conversation turns, relationships and insights all persist', async () => {
    const first = boot();
    await sayAs(first, USER_A, 'Hello there, this should be remembered as a turn.');
    await first.shutdown();

    const second = boot();

    const turns = await second.cognition.workingMemory.recent(
      COMPANION,
      USER_A,
      50,
      {} as never,
    );
    expect(turns.length).toBeGreaterThan(0);
    expect(turns.some((turn) => turn.content.includes('should be remembered'))).toBe(true);

    const relationship = await second.cognition.relationships.current(
      COMPANION,
      USER_A,
      '2026-08-04T09:00:00.000Z' as never,
    );
    expect(relationship.interactionCount).toBeGreaterThan(0);
    expect(relationship.companionId).toBe(COMPANION);
    expect(relationship.userId).toBe(USER_A);

    // Insights are written only when reflection actually forms one, so this
    // asserts the store round-trips rather than that a pattern was found.
    const insights = await second.cognition.insights.all(COMPANION, USER_A);
    expect(Array.isArray(insights)).toBe(true);
    expect(insights.every((insight) => insight.userId === USER_A)).toBe(true);

    // And none of it belongs to B.
    const turnsB = await second.cognition.workingMemory.recent(
      COMPANION,
      USER_B,
      50,
      {} as never,
    );
    expect(turnsB.some((turn) => turn.content.includes('should be remembered'))).toBe(false);

    await second.shutdown();
  }, 60_000);
});
