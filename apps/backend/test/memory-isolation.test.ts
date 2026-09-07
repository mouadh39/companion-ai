import { describe, expect, it } from 'vitest';
import { FixedClock } from '@nexa/shared';
import { ScriptedLanguageModel } from '@nexa/providers';
import { compose, type Application } from '../src/composition.js';
import { countingIds } from '../src/adapters/stores.js';
import { InMemoryWorkingMemory } from '../src/adapters/in-memory.js';
import type { AppConfig } from '../src/config.js';

/**
 * Memory is scoped to a person, not to a companion.
 *
 * One companion may speak to several people. Before this suite existed, every
 * per-user store was keyed on `companionId` alone, so a second user asking the
 * companion a question was answered out of the first user's memories — a
 * privacy failure that looked like working recall.
 *
 * These tests assert the boundary at two levels, because either one alone can
 * pass while the system leaks: the stores hold the key, but Core has to actually
 * hand them the owner. A test that only exercised the store would not have
 * caught a caller that dropped the `userId` on the way in.
 */

const config = {
  port: 0,
  host: '127.0.0.1',
  provider: 'scripted',
  modelId: 'scripted',
  anthropicApiKey: null,
  logLevel: 'silent',
} as unknown as AppConfig;

const COMPANION = 'companion-shared' as never;
const USER_A = 'user-a' as never;
const USER_B = 'user-b' as never;

const build = (): Application =>
  compose(config, {
    clock: new FixedClock(Date.parse('2026-08-04T09:00:00.000Z')),
    ids: countingIds('iso'),
    languageModel: new ScriptedLanguageModel(),
  });

const sayAs = async (app: Application, userId: never, text: string): Promise<void> => {
  await app.turn.run({ companionId: COMPANION, userId, text, source: 'user' });
  await settle();
};

/** Lets the in-process bus drain. It never awaits handlers, by design. */
const settle = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
};

const turn = (content: string) =>
  ({ role: 'user', content, at: '2026-08-04T09:00:00.000Z' }) as never;


describe('working memory is scoped to (companionId, userId)', () => {
  it('A: a user reads back their own turns', async () => {
    const store = new InMemoryWorkingMemory();
    await store.append(COMPANION, USER_A, turn('the sky is green today'));

    const held = await store.recent(COMPANION, USER_A, 10);
    expect(held.map((entry) => entry.content)).toEqual(['the sky is green today']);
  });

  it('B: a different user under the same companion reads nothing', async () => {
    const store = new InMemoryWorkingMemory();
    await store.append(COMPANION, USER_A, turn('the sky is green today'));

    const held = await store.recent(COMPANION, USER_B, 10);
    expect(held).toEqual([]);
  });

  it('C: two users under one companion keep separate histories', async () => {
    const store = new InMemoryWorkingMemory();
    await store.append(COMPANION, USER_A, turn('A speaking'));
    await store.append(COMPANION, USER_B, turn('B speaking'));

    expect((await store.recent(COMPANION, USER_A, 10)).map((e) => e.content)).toEqual([
      'A speaking',
    ]);
    expect((await store.recent(COMPANION, USER_B, 10)).map((e) => e.content)).toEqual([
      'B speaking',
    ]);
  });

  /**
   * The key is length-prefixed rather than joined on a bare separator. Ids reach
   * the backend through `trustExternalId`, which excludes no character, so a
   * naive `${companionId}:${userId}` would put these two distinct pairs in one
   * bucket — reintroducing the leak through the back door.
   */
  it('does not collide when an id contains the separator', async () => {
    const store = new InMemoryWorkingMemory();
    await store.append('a:b' as never, 'c' as never, turn('first pair'));
    await store.append('a' as never, 'b:c' as never, turn('second pair'));

    expect((await store.recent('a:b' as never, 'c' as never, 10)).map((e) => e.content)).toEqual(
      ['first pair'],
    );
    expect((await store.recent('a' as never, 'b:c' as never, 10)).map((e) => e.content)).toEqual(
      ['second pair'],
    );
  });
});

describe('long-term memory is scoped to (companionId, userId)', () => {
  it('A: the user who stated something has it stored against them', async () => {
    const app = build();
    await sayAs(app, USER_A, "That's wrong, I prefer Unity over Unreal for prototyping.");

    expect((await app.cognition.memories.all(COMPANION, USER_A)).length).toBeGreaterThan(0);
    await app.shutdown();
  });

  it('B: another user under the same companion sees none of it', async () => {
    const app = build();
    await sayAs(app, USER_A, "That's wrong, I prefer Unity over Unreal for prototyping.");

    expect(await app.cognition.memories.all(COMPANION, USER_B)).toEqual([]);
    await app.shutdown();
  });

  it('C: each user retrieves only their own memory', async () => {
    const app = build();
    await sayAs(app, USER_A, "That's wrong, I prefer Unity over Unreal for prototyping.");
    await sayAs(app, USER_B, "That's wrong, I prefer Godot over Unreal for prototyping.");

    const forA = await app.cognition.memories.all(COMPANION, USER_A);
    const forB = await app.cognition.memories.all(COMPANION, USER_B);

    expect(forA.length).toBeGreaterThan(0);
    expect(forB.length).toBeGreaterThan(0);

    // Every memory carries its owner, and neither set contains the other's.
    expect(forA.every((memory) => memory.userId === USER_A)).toBe(true);
    expect(forB.every((memory) => memory.userId === USER_B)).toBe(true);

    const idsA = new Set(forA.map((memory) => memory.id));
    expect(forB.some((memory) => idsA.has(memory.id))).toBe(false);
  });

  /**
   * Covers the caller, not just the store.
   *
   * The long-term assertions above would still pass if Core appended every
   * turn to working memory under the wrong owner, because they read a different
   * store. This reads through the same port Core writes to, so a caller that
   * dropped the `userId` on the way in fails here.
   */
  it("a turn from one user does not enter another user's working memory", async () => {
    const app = build();
    await sayAs(app, USER_A, 'my favourite colour is teal');

    const forB = await app.cognition.workingMemory.recent(COMPANION, USER_B, 50, {} as never);
    expect(forB).toEqual([]);

    const forA = await app.cognition.workingMemory.recent(COMPANION, USER_A, 50, {} as never);
    expect(forA.length).toBeGreaterThan(0);
    expect(forA.some((entry) => entry.content.includes('teal'))).toBe(true);

    await app.shutdown();
  });
});
