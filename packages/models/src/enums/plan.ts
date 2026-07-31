/**
 * Where a step stands.
 *
 * `blocked` is separate from `pending` because they call for opposite
 * behaviour: a pending step is waiting its turn and needs nothing, a blocked
 * one is waiting on something and is the single most useful thing a companion
 * can raise unprompted. Collapsing them hides exactly the case worth surfacing —
 * the same reason `Goal` keeps `status` and `progress` apart.
 */
export type PlanStepStatus = 'pending' | 'active' | 'done' | 'blocked' | 'skipped';

export const PLAN_STEP_STATUSES = [
  'pending',
  'active',
  'done',
  'blocked',
  'skipped',
] as const satisfies readonly PlanStepStatus[];

/** True when the step needs nothing further. */
export const isSettledStep = (status: PlanStepStatus): boolean =>
  status === 'done' || status === 'skipped';
