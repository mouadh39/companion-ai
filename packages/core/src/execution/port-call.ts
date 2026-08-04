import type { TurnId } from '@nexa/shared';
import { PortTimeoutError } from '@nexa/shared';
import type { OmissionReason, PortCallRecord, PortOutcome } from '@nexa/models';
import type { Deadline } from './deadline.js';

/**
 * What every port call receives.
 *
 * Uniform across all three port tiers, and non-optional, because the two things
 * it carries are exactly the two a port cannot be trusted to invent for itself:
 * how long the turn is still willing to wait, and whether the caller has
 * already stopped caring.
 *
 * Adding this parameter to a port interface does not break existing
 * implementations — TypeScript permits an implementation to declare fewer
 * parameters than the interface it satisfies — so adapters adopt it when they
 * have something to do with it, not because a signature forced them to.
 */
export interface PortOptions {
  /**
   * Cancellation for this call.
   *
   * Adapters should forward it to `fetch`, the database driver, or the provider
   * SDK. The previous design raced a timer and abandoned the result, which
   * stopped the *waiting* but not the work: the connection stayed held and the
   * provider quota stayed spent. Abandonment survives here only as the fallback
   * for adapters that genuinely cannot be cancelled.
   */
  readonly signal: AbortSignal;
  /** What remains of the turn's budget. Never extends past the parent. */
  readonly deadline: Deadline;
  /** For correlating a port's own logs and spans with the turn. */
  readonly turnId: TurnId;
}

/**
 * A port call's result, with the outcome and cost attached.
 *
 * The outcome vocabulary and the persisted row both live in `@nexa/models`;
 * only this value-carrying form is core's, because a `PortCall<T>` holds a live
 * result and is therefore not a thing that can be written down.
 */
export type PortCall<T> =
  | { readonly port: string; readonly outcome: 'ok'; readonly durationMs: number; readonly value: T }
  | {
      readonly port: string;
      readonly outcome: 'timeout' | 'not_attempted' | 'aborted';
      readonly durationMs: number;
    }
  | {
      readonly port: string;
      readonly outcome: 'error';
      readonly durationMs: number;
      readonly error: Error;
    };

/** The portion of a call worth keeping in the turn record. */
export const toRecord = <T>(call: PortCall<T>): PortCallRecord => ({
  port: call.port,
  outcome: call.outcome,
  durationMs: call.durationMs,
});

/**
 * Maps a failed call to the reason recorded against the dropped context section.
 *
 * `aborted` has no mapping because it is never an omission: the turn itself is
 * over, and there is no context left to be missing a section from.
 */
export const omissionReasonFor = (
  outcome: Exclude<PortOutcome, 'ok' | 'aborted'>,
): OmissionReason => {
  switch (outcome) {
    case 'timeout':
      return 'port_timeout';
    case 'error':
      return 'port_error';
    case 'not_attempted':
      return 'not_attempted';
  }
};

/**
 * Invokes a port under a budget and a cancellation signal.
 *
 * Never throws. A port failing is an expected condition on a path required to
 * degrade rather than fail, so the failure is returned as a value and the
 * caller decides — at the call site — whether this particular port is worth a
 * thinner answer or the end of the turn.
 */
export const callPort = async <T>(
  port: string,
  budgetMs: number,
  options: PortOptions,
  work: (options: PortOptions) => Promise<T>,
): Promise<PortCall<T>> => {
  const startedAt = options.deadline.now();
  const elapsed = (): number => options.deadline.now() - startedAt;

  // Both checks precede the call rather than racing it: spending a connection
  // on work whose result is already unwanted is pure waste, and the two cases
  // are worth reporting separately.
  if (options.signal.aborted) {
    return { port, outcome: 'aborted', durationMs: 0 };
  }

  const budget = Math.min(Math.max(0, budgetMs), options.deadline.remainingMs());
  if (budget <= 0) {
    return { port, outcome: 'not_attempted', durationMs: 0 };
  }

  const controller = new AbortController();
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const onParentAbort = (): void => {
    controller.abort(options.signal.reason);
  };
  options.signal.addEventListener('abort', onParentAbort, { once: true });

  const scoped: PortOptions = {
    signal: controller.signal,
    deadline: options.deadline.subdivide(budget),
    turnId: options.turnId,
  };

  let work_: Promise<T> | undefined;

  try {
    const expiry = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        // Abort first, then reject. Aborting is what actually stops the work;
        // rejecting only stops us waiting on it.
        controller.abort(new PortTimeoutError(port, budget));
        reject(new PortTimeoutError(port, budget));
      }, budget);
    });

    work_ = work(scoped);
    const value = await Promise.race([work_, expiry]);
    return { port, outcome: 'ok', durationMs: elapsed(), value };
  } catch (cause) {
    if (timedOut) {
      return { port, outcome: 'timeout', durationMs: elapsed() };
    }
    if (options.signal.aborted) {
      return { port, outcome: 'aborted', durationMs: elapsed() };
    }
    return {
      port,
      outcome: 'error',
      durationMs: elapsed(),
      error: cause instanceof Error ? cause : new Error(String(cause)),
    };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    options.signal.removeEventListener('abort', onParentAbort);
    // A rejected promise nobody awaits becomes an unhandled rejection and, under
    // Node's default policy, takes the process down. The timeout path abandons
    // exactly such a promise, so it is claimed here.
    void work_?.catch(() => undefined);
  }
};
