/**
 * Where a goal stands.
 *
 * `abandoned` is distinct from `completed` and both are distinct from deletion,
 * because `16_Goal_Engine.md` requires abandoned goals to remain visible. A goal
 * the user gave up on is information about the user; erasing it means the
 * companion cheerfully proposes the same thing again in three months.
 *
 * `blocked` is separate from `active` for the same reason a blocked task is not
 * an idle one: it names something to resolve rather than something to resume.
 */
export type GoalStatus = 'proposed' | 'active' | 'blocked' | 'completed' | 'abandoned';

export const GOAL_STATUSES = [
  'proposed',
  'active',
  'blocked',
  'completed',
  'abandoned',
] as const satisfies readonly GoalStatus[];

/** Statuses that no longer consume attention. Terminal states are never re-entered. */
export const TERMINAL_GOAL_STATUSES = [
  'completed',
  'abandoned',
] as const satisfies readonly GoalStatus[];

export const isTerminalGoalStatus = (status: GoalStatus): boolean =>
  (TERMINAL_GOAL_STATUSES as readonly GoalStatus[]).includes(status);

/**
 * The timescale a goal operates on.
 *
 * Retrieval weights these differently. A `session` goal is urgent and
 * irrelevant tomorrow; a `life` goal is never urgent and always relevant. One
 * priority number cannot express that difference, so the horizon carries it.
 */
export type GoalHorizon = 'session' | 'short_term' | 'long_term' | 'life';

export const GOAL_HORIZONS = [
  'session',
  'short_term',
  'long_term',
  'life',
] as const satisfies readonly GoalHorizon[];

/**
 * Who wanted this goal to exist.
 *
 * A companion that proposes goals must never be able to present its own
 * suggestion back to the user as something they asked for. Recording the origin
 * is what keeps autonomous behaviour honest.
 */
export type GoalOrigin = 'user_stated' | 'companion_proposed' | 'inferred';

export const GOAL_ORIGINS = [
  'user_stated',
  'companion_proposed',
  'inferred',
] as const satisfies readonly GoalOrigin[];
