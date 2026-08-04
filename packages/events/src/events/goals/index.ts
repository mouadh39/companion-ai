import type { GoalHorizon, GoalId, GoalOrigin, GoalStatus, Priority, Progress } from '@nexa/models';
import type { EventEnvelope } from '../../interfaces/envelope.js';
import { defineEvent } from '../../interfaces/envelope.js';

/**
 * Facts about what the user is trying to achieve.
 *
 * `nexa.goal.abandoned` is the accepted spelling of the brief's
 * `GoalCancelled`, and the distinction from `completed` is deliberate:
 * `16_Goal_Engine.md` requires abandoned goals to stay visible, because a goal
 * someone gave up on is information about them. Erasing it produces a companion
 * that cheerfully re-proposes the same thing three months later.
 */

export interface GoalCreatedPayload {
  readonly goalId: GoalId;
  readonly description: string;
  readonly priority: Priority;
  readonly horizon: GoalHorizon;
  /** Whether the user asked for this or the companion proposed it. */
  readonly origin: GoalOrigin;
}

export interface GoalUpdatedPayload {
  readonly goalId: GoalId;
  readonly previousStatus: GoalStatus;
  readonly status: GoalStatus;
  readonly progress: Progress;
}

export interface GoalCompletedPayload {
  readonly goalId: GoalId;
  /** Days from creation to completion. The pace a plan actually moved at. */
  readonly durationDays: number;
}

export interface GoalAbandonedPayload {
  readonly goalId: GoalId;
  readonly reason: string;
  /** How far it had got. A goal abandoned at 0.9 is worth noticing. */
  readonly progress: Progress;
}

export const goalCreated = defineEvent<'nexa.goal.created', GoalCreatedPayload>(
  'nexa.goal.created',
  1,
  { source: 'planning' },
);

export const goalUpdated = defineEvent<'nexa.goal.updated', GoalUpdatedPayload>(
  'nexa.goal.updated',
  1,
  { source: 'planning' },
);

export const goalCompleted = defineEvent<'nexa.goal.completed', GoalCompletedPayload>(
  'nexa.goal.completed',
  1,
  { source: 'planning' },
);

export const goalAbandoned = defineEvent<'nexa.goal.abandoned', GoalAbandonedPayload>(
  'nexa.goal.abandoned',
  1,
  { source: 'planning' },
);

export type GoalEvent =
  | EventEnvelope<'nexa.goal.created', GoalCreatedPayload>
  | EventEnvelope<'nexa.goal.updated', GoalUpdatedPayload>
  | EventEnvelope<'nexa.goal.completed', GoalCompletedPayload>
  | EventEnvelope<'nexa.goal.abandoned', GoalAbandonedPayload>;

export const GOAL_EVENTS = [goalCreated, goalUpdated, goalCompleted, goalAbandoned] as const;
