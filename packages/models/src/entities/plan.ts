import type { GoalId, PlanId, ToolId } from '@nexa/shared';
import type { PlanStepStatus } from '../enums/plan.js';
import type { Timestamp } from '../value-objects/timestamp.js';

/**
 * One step of a plan, as the turn reads it.
 *
 * Deliberately thin. The Planning Engine owns the real model — decomposition
 * rules, dependency resolution, replanning triggers — and none of that belongs
 * in the shape the conversational turn consumes. Defining a full `Plan` entity
 * here would be inventing a domain that has not been designed yet, and every
 * consumer would then be coupled to guesses.
 */
export interface PlanStep {
  /** One line, in the user's terms. Enters the prompt directly. */
  readonly description: string;
  readonly status: PlanStepStatus;
  /** The tool that advances this step, when one does. */
  readonly toolId: ToolId | null;
  /** Why it cannot proceed, when `status` is `blocked`. */
  readonly blockedReason: string | null;
}

/**
 * The current state of the plan the companion is helping with.
 *
 * Read once per turn and **not recomputed** during it. Multi-step goal
 * decomposition on the path of "how was your day?" is latency spent on almost
 * every turn to serve almost none, so planning runs in the worker on
 * `nexa.turn.completed` and the turn reads whatever the last pass produced.
 *
 * The consequence is stated rather than hidden: the plan may be one turn stale.
 * That is the intended trade. `revisedAt` is carried so a consumer can tell.
 */
export interface PlanSnapshot {
  readonly planId: PlanId;
  /** The goal this plan serves. */
  readonly goalId: GoalId;
  readonly steps: readonly PlanStep[];
  /**
   * Index into `steps` of the step in progress, or null when none is.
   *
   * An index rather than a copy of the step, so there is one representation of
   * "where we are" and no way for the two to disagree.
   */
  readonly activeStepIndex: number | null;
  readonly revisedAt: Timestamp;
}

/** The step in progress, or null when the plan is between steps. */
export const activeStep = (plan: PlanSnapshot): PlanStep | null => {
  if (plan.activeStepIndex === null) return null;
  return plan.steps[plan.activeStepIndex] ?? null;
};

/** Steps that cannot proceed. The most useful thing to raise unprompted. */
export const blockedSteps = (plan: PlanSnapshot): readonly PlanStep[] =>
  plan.steps.filter((step) => step.status === 'blocked');
