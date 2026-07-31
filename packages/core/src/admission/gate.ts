import type { CompanionId } from '@nexa/shared';
import type { PortOptions } from '../execution/index.js';

/** Called exactly once, when a turn is finished with its companion. */
export type ReleaseTurn = () => void;

/**
 * Serialises turns for one companion.
 *
 * Two devices talking to the same companion is not a hypothetical — it is the
 * multi-device requirement — and without this, both turns read the same working
 * memory, both append to it, and one exchange overwrites the other's view of
 * the conversation. The corruption is silent and very hard to diagnose after
 * the fact, because each turn looks correct in isolation.
 *
 * The queue is per companion, never global: two users must never wait on each
 * other. Within a companion it is FIFO.
 *
 * This is also the cheapest 80% of the actor model, and deliberately
 * actor-shaped. When the backend outgrows one process, the same interface is
 * satisfied by a distributed lease, and nothing above it changes.
 */
export interface TurnGate {
  /**
   * Waits for exclusive access.
   *
   * Resolves to a release function, or **null** when the turn's deadline passed
   * or it was cancelled while queuing. Null rather than a throw because being
   * too late to start is an ordinary outcome on this path, not an exception.
   */
  acquire(companionId: CompanionId, options: PortOptions): Promise<ReleaseTurn | null>;
}

interface Queue {
  /** Resolves when the turn currently holding the companion is done. */
  tail: Promise<void>;
  /** Live acquirers, so the entry can be dropped when the companion goes quiet. */
  waiting: number;
}

/**
 * In-process serialisation.
 *
 * Correct for a single API process, which is what ships today. It is not a
 * distributed lock and does not pretend to be — with two processes, two turns
 * for one companion can still overlap. That is a deployment-topology problem
 * with a deployment-topology fix, and this interface is the seam for it.
 */
export class InProcessTurnGate implements TurnGate {
  readonly #queues = new Map<string, Queue>();

  async acquire(
    companionId: CompanionId,
    options: PortOptions,
  ): Promise<ReleaseTurn | null> {
    const entry = this.#queues.get(companionId) ?? { tail: Promise.resolve(), waiting: 0 };
    this.#queues.set(companionId, entry);
    entry.waiting += 1;

    const previous = entry.tail;

    let release!: () => void;
    const mine = new Promise<void>((resolve) => {
      release = resolve;
    });

    // Installed as the new tail *synchronously*, before any await. That is what
    // makes the queue FIFO: a second acquirer entering on the next tick waits
    // on this turn rather than on the one this turn is itself waiting for.
    entry.tail = mine;

    let released = false;
    const finish = (): void => {
      if (released) return;
      released = true;
      release();
      entry.waiting -= 1;
      // Dropped once nobody is queued, so a long-lived process does not
      // accumulate an entry per companion it has ever served.
      if (entry.waiting === 0 && this.#queues.get(companionId) === entry) {
        this.#queues.delete(companionId);
      }
    };

    const admitted = await waitFor(previous, options);
    if (!admitted) {
      // Releasing on the way out is essential: the turns queued behind this one
      // are waiting on `mine`, and abandoning it would stall the companion for
      // the life of the process.
      finish();
      return null;
    }

    return finish;
  }
}

/**
 * Waits for a promise, giving up when the deadline passes or the turn is
 * cancelled.
 *
 * Never rejects — the caller wants a decision, not an exception, and both
 * failure modes here mean the same thing: do not proceed.
 */
const waitFor = async (work: Promise<void>, options: PortOptions): Promise<boolean> => {
  if (options.signal.aborted) return false;

  const remaining = options.deadline.remainingMs();
  if (remaining <= 0) return false;

  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;

  try {
    const expiry = new Promise<false>((resolve) => {
      timer = setTimeout(() => {
        resolve(false);
      }, remaining);
    });

    const cancelled = new Promise<false>((resolve) => {
      onAbort = () => {
        resolve(false);
      };
      options.signal.addEventListener('abort', onAbort, { once: true });
    });

    return await Promise.race([work.then(() => true), expiry, cancelled]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (onAbort !== undefined) options.signal.removeEventListener('abort', onAbort);
  }
};
