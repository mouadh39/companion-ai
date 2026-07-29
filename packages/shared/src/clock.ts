/**
 * The source of "now".
 *
 * Nothing in Nexa calls `Date.now()` directly. Two reasons, and the second is
 * the load-bearing one:
 *
 * 1. Tests over time-dependent behaviour — memory decay, emotional recovery,
 *    relationship growth — need to advance time, not wait for it.
 * 2. The `Deliberator` is a pure function, and a clock read inside it would
 *    silently break that. Time arrives *in* the cognitive context, sampled once
 *    at the start of the turn, so replaying a decision reproduces it exactly.
 */
export interface Clock {
  /** Milliseconds since the Unix epoch. */
  now(): number;
  /** Current instant as an ISO 8601 string in UTC. */
  nowIso(): string;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  nowIso: () => new Date().toISOString(),
};

/**
 * A clock under test control. Starts frozen and only moves when told to.
 */
export class FixedClock implements Clock {
  #current: number;

  constructor(start: Date | number = 0) {
    this.#current = typeof start === 'number' ? start : start.getTime();
  }

  now(): number {
    return this.#current;
  }

  nowIso(): string {
    return new Date(this.#current).toISOString();
  }

  advance(milliseconds: number): void {
    this.#current += milliseconds;
  }

  set(instant: Date | number): void {
    this.#current = typeof instant === 'number' ? instant : instant.getTime();
  }
}
