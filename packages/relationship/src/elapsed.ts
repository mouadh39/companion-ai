/**
 * Time arithmetic, without a clock.
 *
 * Every function here takes both ends explicitly. The engine never asks what
 * time it is — the caller supplies `at`, exactly as it supplies the identity
 * version and the perception. That is what makes a replayed sequence of signals
 * reproduce the same relationship: re-running last March's turns today would
 * otherwise compute a year of extra elapsed time and advance a relationship
 * that never advanced.
 *
 * `Date.parse` is used rather than `new Date()`. Parsing a supplied string is
 * pure; constructing a date from nothing is a clock read.
 */

const MS_PER_DAY = 86_400_000;

/**
 * Whole and fractional days from `from` to `to`.
 *
 * Returns 0 rather than a negative number when `to` precedes `from`. Clock skew
 * between a client and a server produces exactly that, and a negative elapsed
 * time would flow into a progress ratio and produce a stage that goes backwards
 * for a reason nobody could find.
 *
 * Returns 0 for an unparseable timestamp too. `Timestamp` is branded and
 * validated at construction, so this is unreachable through the normal path —
 * but a record restored from a bad backup should not make the engine throw on a
 * turn the user is waiting on.
 */
export const daysBetween = (from: string, to: string): number => {
  const start = Date.parse(from);
  const end = Date.parse(to);

  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.max(0, (end - start) / MS_PER_DAY);
};

/**
 * Average days between interactions over the life of the relationship.
 *
 * `Infinity` when there has been at most one interaction — there is no interval
 * yet, and returning 0 would read as "constant contact", which is the opposite
 * of the truth on a first meeting.
 */
export const averageGapDays = (
  firstMetAt: string,
  lastInteractionAt: string,
  interactionCount: number,
): number => {
  if (interactionCount <= 1) return Number.POSITIVE_INFINITY;

  const span = daysBetween(firstMetAt, lastInteractionAt);
  // Intervals, not events: five interactions bound four gaps.
  return span / (interactionCount - 1);
};
