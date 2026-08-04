/**
 * How the turn's total time is divided between its stages.
 *
 * Only the stages with a *fixed* allotment appear here. Assembly's ceiling
 * lives in `AssemblerOptions` beside the per-port ceiling it bounds, and
 * generation has no fixed allotment at all — it receives whatever remains, less
 * the commit reserve. That asymmetry is deliberate: generation is the stage
 * whose cost is genuinely unpredictable, so it should absorb the variance
 * rather than be capped by a number chosen in advance.
 */
export interface TurnBudget {
  /**
   * The whole turn, when the caller does not supply a deadline of its own.
   *
   * Generous by default because a real provider call can take several seconds
   * and a turn that dies at an arbitrary internal limit is worse than a slow
   * one. Callers that genuinely care — an interactive client with a spinner —
   * are expected to pass their own deadline rather than tune this.
   */
  readonly totalMs: number;

  /** Perception is local string work; exceeding this means something is wrong. */
  readonly perceptionMs: number;

  /**
   * Held back from generation so commit always has time to run.
   *
   * Producing an answer and then failing to persist it is strictly worse than
   * producing a slightly shorter one — the user sees a reply that the companion
   * will have no memory of having given.
   */
  readonly commitReserveMs: number;
}

export const defaultTurnBudget: TurnBudget = {
  totalMs: 30_000,
  perceptionMs: 100,
  commitReserveMs: 250,
};
