import type { Clock } from '@nexa/shared';

/**
 * The turn's time budget, as a value that can be subdivided but never extended.
 *
 * This replaces the fixed per-port timeout the assembler used to carry. A fixed
 * constant composes badly: under load, assembly could spend its full allowance
 * on every port in turn and still return nothing, and no number written into
 * `AssemblerOptions` has any relationship to what the caller was actually
 * willing to wait for.
 *
 * A deadline is absolute rather than a duration, which is what makes
 * propagation meaningful — a port called at the end of assembly sees the time
 * that is genuinely left, not the time the stage was nominally allotted.
 *
 * The load-bearing invariant is in {@link subdivide}: a child deadline can
 * never outlive its parent. That is what stops a stage from quietly borrowing
 * from the stages after it, and it is why the reserve in
 * {@link Deadline.withReserve} actually holds.
 */
export class Deadline {
  readonly #clock: Clock;

  /** When the budget began. Absolute epoch milliseconds. */
  readonly startedAt: number;
  /** When the budget ends. Absolute epoch milliseconds. */
  readonly expiresAt: number;

  private constructor(clock: Clock, startedAt: number, expiresAt: number) {
    this.#clock = clock;
    this.startedAt = startedAt;
    // A deadline that ends before it starts is a bug at the call site, not a
    // state worth representing: clamping keeps `remainingMs` non-negative
    // without every caller having to check.
    this.expiresAt = Math.max(startedAt, expiresAt);
  }

  /** A budget of `budgetMs` starting now. */
  static after(clock: Clock, budgetMs: number): Deadline {
    const now = clock.now();
    return new Deadline(clock, now, now + Math.max(0, budgetMs));
  }

  /**
   * A budget ending at an absolute instant.
   *
   * This is the form a caller supplies: the client knows when it stops caring
   * about the answer, which is a wall-clock fact, not a duration.
   */
  static at(clock: Clock, expiresAt: number): Deadline {
    return new Deadline(clock, clock.now(), expiresAt);
  }

  /** Current time from the injected clock. Nothing here calls `Date.now()`. */
  now(): number {
    return this.#clock.now();
  }

  remainingMs(): number {
    return Math.max(0, this.expiresAt - this.#clock.now());
  }

  elapsedMs(): number {
    return this.#clock.now() - this.startedAt;
  }

  hasExpired(): boolean {
    return this.#clock.now() >= this.expiresAt;
  }

  /**
   * A child budget of at most `budgetMs`, bounded by what remains here.
   *
   * The `min` is the whole point. A stage asking for 400ms when 120ms is left
   * gets 120ms, so an over-budget turn degrades at the stage that is actually
   * late rather than at whichever stage happens to run last.
   */
  subdivide(budgetMs: number): Deadline {
    const now = this.#clock.now();
    return new Deadline(this.#clock, now, Math.min(this.expiresAt, now + Math.max(0, budgetMs)));
  }

  /**
   * This budget with `reserveMs` held back for the stages that follow.
   *
   * Used to protect commit. Producing an answer and then failing to persist it
   * is strictly worse than producing a slightly shorter answer, so generation
   * is handed a deadline that cannot consume the commit reserve.
   */
  withReserve(reserveMs: number): Deadline {
    const now = this.#clock.now();
    return new Deadline(
      this.#clock,
      now,
      Math.max(now, this.expiresAt - Math.max(0, reserveMs)),
    );
  }
}
