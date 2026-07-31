import { describe, expect, it } from 'vitest';
import { Deadline, callPort, omissionReasonFor, toRecord } from '@nexa/core';
import type { PortOptions } from '@nexa/core';
import { FixedClock, systemClock, trustExternalId } from '@nexa/shared';
import type { TurnId } from '@nexa/shared';

/**
 * The execution primitives, held to the two properties everything else assumes.
 *
 * A budget that can be extended by a child, or a cancellation that stops the
 * waiting but not the work, would each be invisible in normal operation and
 * catastrophic under load — the failure mode is a turn that quietly outlives
 * its caller while holding a connection. These tests are the only place those
 * properties are checked directly.
 */

const turnId = trustExternalId<TurnId>('00000000-0000-7000-8000-000000000001');

/** Deadlines driven by a frozen clock, so budget arithmetic is not a race. */
const fixed = (budgetMs: number): { clock: FixedClock; deadline: Deadline } => {
  const clock = new FixedClock(1_000_000);
  return { clock, deadline: Deadline.after(clock, budgetMs) };
};

/** Real time, for the paths where a real timer has to fire. */
const live = (budgetMs: number): PortOptions => ({
  signal: new AbortController().signal,
  deadline: Deadline.after(systemClock, budgetMs),
  turnId,
});

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

describe('Deadline', () => {
  it('reports the budget it was given', () => {
    const { deadline } = fixed(500);
    expect(deadline.remainingMs()).toBe(500);
    expect(deadline.hasExpired()).toBe(false);
  });

  it('drains as the clock advances', () => {
    const { clock, deadline } = fixed(500);
    clock.advance(200);
    expect(deadline.remainingMs()).toBe(300);
    expect(deadline.elapsedMs()).toBe(200);
  });

  it('expires once, and never reports negative time remaining', () => {
    const { clock, deadline } = fixed(100);
    clock.advance(250);
    expect(deadline.hasExpired()).toBe(true);
    expect(deadline.remainingMs()).toBe(0);
  });

  it('clamps a negative budget rather than expiring in the past', () => {
    const clock = new FixedClock(1_000_000);
    const deadline = Deadline.after(clock, -50);
    expect(deadline.remainingMs()).toBe(0);
    expect(deadline.expiresAt).toBe(deadline.startedAt);
  });

  it('gives a child the budget it asks for when the parent can afford it', () => {
    const { deadline } = fixed(500);
    expect(deadline.subdivide(200).remainingMs()).toBe(200);
  });

  /**
   * The invariant the whole propagation scheme rests on. Without it a stage
   * could ask for more than the turn has left and get it, and the caller's
   * deadline would become advisory.
   */
  it('never lets a child outlive its parent', () => {
    const { deadline } = fixed(120);
    const child = deadline.subdivide(5_000);

    expect(child.remainingMs()).toBe(120);
    expect(child.expiresAt).toBe(deadline.expiresAt);
  });

  it('shortens a child as the parent drains', () => {
    const { clock, deadline } = fixed(500);
    clock.advance(400);
    expect(deadline.subdivide(300).remainingMs()).toBe(100);
  });

  it('holds back a reserve for the stages that follow', () => {
    const { deadline } = fixed(1_000);
    const generation = deadline.withReserve(250);

    expect(generation.remainingMs()).toBe(750);
    expect(generation.expiresAt).toBeLessThan(deadline.expiresAt);
  });

  it('yields no time at all when the reserve exceeds what is left', () => {
    const { deadline } = fixed(100);
    expect(deadline.withReserve(400).remainingMs()).toBe(0);
  });
});

describe('callPort', () => {
  it('returns the value and the cost on success', async () => {
    const call = await callPort('memory', 200, live(1_000), async () => 'recalled');

    expect(call.outcome).toBe('ok');
    expect(call.outcome === 'ok' && call.value).toBe('recalled');
    expect(call.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('reports a timeout rather than throwing', async () => {
    const call = await callPort('slow', 30, live(1_000), async () => {
      await sleep(500);
      return 'too late';
    });

    expect(call.outcome).toBe('timeout');
  });

  /**
   * The reason cancellation was introduced at all. The previous design raced a
   * timer and abandoned the promise: the port never learned it had lost, so it
   * kept its connection and kept spending provider quota.
   */
  it('cancels the port when its budget expires', async () => {
    let observed: AbortSignal | undefined;

    const call = await callPort('slow', 30, live(1_000), async (scoped) => {
      observed = scoped.signal;
      await sleep(500);
      return 'too late';
    });

    expect(call.outcome).toBe('timeout');
    expect(observed?.aborted).toBe(true);
  });

  it('captures a thrown error as an outcome', async () => {
    const call = await callPort('broken', 200, live(1_000), () => {
      throw new Error('index unavailable');
    });

    expect(call.outcome).toBe('error');
    expect(call.outcome === 'error' && call.error.message).toBe('index unavailable');
  });

  it('normalises a non-Error rejection', async () => {
    // Rejecting with a bare string is the condition under test: a third-party
    // SDK doing this must not put a non-Error into `call.error`, where every
    // consumer expects `.message`.
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
    const call = await callPort('broken', 200, live(1_000), () => Promise.reject('nope'));

    expect(call.outcome).toBe('error');
    expect(call.outcome === 'error' && call.error).toBeInstanceOf(Error);
  });

  /**
   * The diagnostic payoff of propagation: this port was never slow, the turn
   * was simply already out of time. A single `timeout` outcome would send you
   * optimising the wrong dependency.
   */
  it('does not attempt a call once the deadline has passed', async () => {
    const clock = new FixedClock(1_000_000);
    const deadline = Deadline.after(clock, 100);
    clock.advance(200);

    let invoked = false;
    const call = await callPort(
      'late',
      50,
      { signal: new AbortController().signal, deadline, turnId },
      async () => {
        invoked = true;
        return 'unreachable';
      },
    );

    expect(call.outcome).toBe('not_attempted');
    expect(invoked).toBe(false);
  });

  it('does not attempt a call that is already cancelled', async () => {
    const controller = new AbortController();
    controller.abort();

    let invoked = false;
    const call = await callPort(
      'cancelled',
      200,
      { signal: controller.signal, deadline: Deadline.after(systemClock, 1_000), turnId },
      async () => {
        invoked = true;
        return 'unreachable';
      },
    );

    expect(call.outcome).toBe('aborted');
    expect(invoked).toBe(false);
  });

  it('propagates a cancellation that arrives mid-flight', async () => {
    const controller = new AbortController();
    setTimeout(() => {
      controller.abort();
    }, 20);

    const call = await callPort(
      'inflight',
      1_000,
      { signal: controller.signal, deadline: Deadline.after(systemClock, 5_000), turnId },
      async (scoped) =>
        new Promise<string>((_resolve, reject) => {
          scoped.signal.addEventListener('abort', () => {
            reject(new Error('aborted'));
          });
        }),
    );

    expect(call.outcome).toBe('aborted');
  });

  it('hands the port a deadline bounded by the turn, not by the request', async () => {
    let seen = 0;
    await callPort('bounded', 10_000, live(120), async (scoped) => {
      seen = scoped.deadline.remainingMs();
      return null;
    });

    expect(seen).toBeGreaterThan(0);
    expect(seen).toBeLessThanOrEqual(120);
  });

  it('survives a port that rejects after being abandoned', async () => {
    const call = await callPort('leaky', 20, live(1_000), async () => {
      await sleep(60);
      throw new Error('late rejection nobody awaits');
    });

    expect(call.outcome).toBe('timeout');
    // The orphaned rejection must be claimed inside callPort; an unhandled one
    // takes the process down under Node's default policy.
    await sleep(120);
  });
});

describe('outcome mapping', () => {
  it('distinguishes a slow port from a turn that ran out of time', () => {
    expect(omissionReasonFor('timeout')).toBe('port_timeout');
    expect(omissionReasonFor('error')).toBe('port_error');
    expect(omissionReasonFor('not_attempted')).toBe('not_attempted');
  });

  it('keeps only what the turn record needs', async () => {
    const record = toRecord(await callPort('memory', 200, live(1_000), async () => 'v'));

    expect(record).toEqual({
      port: 'memory',
      outcome: 'ok',
      durationMs: record.durationMs,
    });
  });
});
