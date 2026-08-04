/**
 * Where a step stands.
 *
 * `blocked` is separate from `pending` because they call for opposite
 * behaviour: a pending step is waiting its turn and needs nothing, a blocked
 * one is waiting on something and is the single most useful thing a companion
 * can raise unprompted. Collapsing them hides exactly the case worth surfacing —
 * the same reason `Goal` keeps `status` and `progress` apart.
 */
export type TaskStepStatus = 'pending' | 'active' | 'done' | 'blocked' | 'skipped';

export const TASK_STEP_STATUSES = [
  'pending',
  'active',
  'done',
  'blocked',
  'skipped',
] as const satisfies readonly TaskStepStatus[];

/** True when the step needs nothing further. */
export const isSettledStep = (status: TaskStepStatus): boolean =>
  status === 'done' || status === 'skipped';
