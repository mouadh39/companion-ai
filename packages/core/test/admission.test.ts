import { describe, expect, it } from 'vitest';
import {
  Deadline,
  InMemoryIdempotencyStore,
  InProcessTurnGate,
} from '@nexa/core';
import type { PortOptions } from '@nexa/core';
import { FixedClock, systemClock, trustExternalId } from '@nexa/shared';
import type { CompanionId, TurnId } from '@nexa/shared';

/**
 * Stage 0.
 *
 * Everything here prevents a corruption that is silent by nature: overlapping
 * turns interleave their writes to working memory, and a retried request runs
 * every side effect twice. Both look correct in any single turn's logs, which
 * is why they need tests rather than monitoring.
 */

const turnId = trustExternalId<TurnId>('00000000-0000-7000-8000-0000000000dd');
const companion = (n: number): CompanionId =>
  trustExternalId<CompanionId>(`companion-${n}`);

const options = (budgetMs = 1_000): PortOptions => ({
  signal: new AbortController().signal,
  deadline: Deadline.after(systemClock, budgetMs),
  turnId,
});

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

describe('InProcessTurnGate', () => {
  it('admits an uncontended turn immediately', async () => {
    const release = await new InProcessTurnGate().acquire(companion(1), options());
    expect(release).not.toBeNull();
    release?.();
  });

  /**
   * The corruption this exists to prevent: both turns read the same working
   * memory, both append, and one exchange overwrites the other's view.
   */
  it('serialises two turns for the same companion', async () => {
    const gate = new InProcessTurnGate();
    const order: string[] = [];

    const first = await gate.acquire(companion(1), options());

    const second = (async () => {
      const release = await gate.acquire(companion(1), options());
      order.push('second-entered');
      release?.();
    })();

    await sleep(20);
    order.push('first-still-held');
    first?.();

    await second;
    expect(order).toEqual(['first-still-held', 'second-entered']);
  });

  /** Two users must never wait on each other. */
  it('does not serialise across companions', async () => {
    const gate = new InProcessTurnGate();
    const held = await gate.acquire(companion(1), options());

    const other = await gate.acquire(companion(2), options());

    expect(other).not.toBeNull();
    held?.();
    other?.();
  });

  it('preserves arrival order', async () => {
    const gate = new InProcessTurnGate();
    const entered: number[] = [];

    const first = await gate.acquire(companion(1), options());

    const queued = [1, 2, 3].map(async (n) => {
      // Staggered so registration order is deterministic; the gate is FIFO on
      // the order acquire() was *called*, not on the order it resolves.
      await sleep(n * 5);
      const release = await gate.acquire(companion(1), options());
      entered.push(n);
      release?.();
    });

    await sleep(40);
    first?.();
    await Promise.all(queued);

    expect(entered).toEqual([1, 2, 3]);
  });

  it('gives up when the deadline passes while queued', async () => {
    const gate = new InProcessTurnGate();
    const held = await gate.acquire(companion(1), options());

    const late = await gate.acquire(companion(1), options(30));

    expect(late).toBeNull();
    held?.();
  });

  it('gives up when the turn is cancelled while queued', async () => {
    const gate = new InProcessTurnGate();
    const held = await gate.acquire(companion(1), options());

    const controller = new AbortController();
    setTimeout(() => {
      controller.abort();
    }, 20);

    const cancelled = await gate.acquire(companion(1), {
      signal: controller.signal,
      deadline: Deadline.after(systemClock, 5_000),
      turnId,
    });

    expect(cancelled).toBeNull();
    held?.();
  });

  /**
   * The subtle one. A turn that gives up while queued is still part of the
   * chain, so abandoning its slot would stall the companion permanently —
   * every turn behind it would wait on a promise nothing resolves.
   */
  it('does not stall the queue when a waiter gives up', async () => {
    const gate = new InProcessTurnGate();
    const held = await gate.acquire(companion(1), options());

    const abandoned = gate.acquire(companion(1), options(20));
    const following = gate.acquire(companion(1), options(2_000));

    expect(await abandoned).toBeNull();
    held?.();

    const release = await following;
    expect(release).not.toBeNull();
    release?.();
  });

  it('admits again cleanly after a companion goes quiet', async () => {
    const gate = new InProcessTurnGate();

    for (let i = 0; i < 3; i++) {
      const release = await gate.acquire(companion(1), options());
      expect(release).not.toBeNull();
      release?.();
    }
  });

  it('is safe to release twice', async () => {
    const gate = new InProcessTurnGate();
    const release = await gate.acquire(companion(1), options());

    release?.();
    expect(() => release?.()).not.toThrow();

    const next = await gate.acquire(companion(1), options());
    expect(next).not.toBeNull();
    next?.();
  });
});

describe('InMemoryIdempotencyStore', () => {
  it('returns nothing for an unseen key', async () => {
    const store = new InMemoryIdempotencyStore<string>(new FixedClock(1_000));
    expect(await store.lookup('a')).toBeUndefined();
  });

  it('replays what a key produced', async () => {
    const store = new InMemoryIdempotencyStore<string>(new FixedClock(1_000));
    await store.remember('a', 'the answer');

    expect(await store.lookup('a')).toBe('the answer');
  });

  it('forgets an entry past its time to live', async () => {
    const clock = new FixedClock(1_000);
    const store = new InMemoryIdempotencyStore<string>(clock, {
      ttlMs: 100,
      maxEntries: 10,
    });

    await store.remember('a', 'the answer');
    clock.advance(101);

    expect(await store.lookup('a')).toBeUndefined();
  });

  it('keeps an entry that is exactly at its time to live', async () => {
    const clock = new FixedClock(1_000);
    const store = new InMemoryIdempotencyStore<string>(clock, {
      ttlMs: 100,
      maxEntries: 10,
    });

    await store.remember('a', 'the answer');
    clock.advance(100);

    expect(await store.lookup('a')).toBe('the answer');
  });

  /** A client generating keys must not be able to exhaust the process. */
  it('evicts the oldest entry at capacity', async () => {
    const store = new InMemoryIdempotencyStore<string>(new FixedClock(1_000), {
      ttlMs: 60_000,
      maxEntries: 2,
    });

    await store.remember('a', '1');
    await store.remember('b', '2');
    await store.remember('c', '3');

    expect(store.size).toBe(2);
    expect(await store.lookup('a')).toBeUndefined();
    expect(await store.lookup('c')).toBe('3');
  });
});
