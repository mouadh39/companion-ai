import type { GoalId } from '@nexa/models';
import type { EventEnvelope } from '../../interfaces/envelope.js';
import { defineEvent } from '../../interfaces/envelope.js';

/**
 * Facts about plans — the sequences of steps that serve a goal.
 *
 * A plan is not yet an entity in `@nexa/models`, so `planId` is a plain string
 * here rather than a branded id. That is a deliberate marker: when the Planning
 * Engine lands and `Plan` becomes a domain type, this narrows to `PlanId` and
 * the change is additive at the type level. Inventing a brand in this package
 * would put a second source of truth for identity above the domain layer.
 *
 * `nexa.plan.revised` is the accepted spelling of the brief's `PlanUpdated`,
 * and it carries what changed rather than the new plan: a consumer that needs
 * the steps loads them through a port.
 */

export interface PlanCreatedPayload {
  readonly planId: string;
  readonly goalId: GoalId;
  readonly taskCount: number;
}

export interface PlanRevisedPayload {
  readonly planId: string;
  readonly added: number;
  readonly removed: number;
  /** Why the plan moved. The most useful field for understanding drift. */
  readonly reason: string;
}

export interface PlanCompletedPayload {
  readonly planId: string;
  readonly goalId: GoalId;
  readonly durationDays: number;
  /** Tasks finished versus originally planned. Reveals systematic optimism. */
  readonly completedTasks: number;
  readonly plannedTasks: number;
}

export const planCreated = defineEvent<'nexa.plan.created', PlanCreatedPayload>(
  'nexa.plan.created',
  1,
  { source: 'planning' },
);

export const planRevised = defineEvent<'nexa.plan.revised', PlanRevisedPayload>(
  'nexa.plan.revised',
  1,
  { source: 'planning' },
);

export const planCompleted = defineEvent<'nexa.plan.completed', PlanCompletedPayload>(
  'nexa.plan.completed',
  1,
  { source: 'planning' },
);

export type PlanEvent =
  | EventEnvelope<'nexa.plan.created', PlanCreatedPayload>
  | EventEnvelope<'nexa.plan.revised', PlanRevisedPayload>
  | EventEnvelope<'nexa.plan.completed', PlanCompletedPayload>;

export const PLAN_EVENTS = [planCreated, planRevised, planCompleted] as const;
