import type { GoalId, UserId } from '@nexa/shared';
import type { GoalHorizon, GoalOrigin, GoalStatus } from '../enums/goal.js';
import type { Priority, Progress } from '../value-objects/score.js';
import type { Timestamp } from '../value-objects/timestamp.js';
import type { Metadata } from '../value-objects/metadata.js';

/**
 * Something the user is trying to achieve.
 *
 * Goals are the companion's answer to "why does this matter?" — they weight
 * memory retrieval, they justify proactive suggestions, and they are what makes
 * the difference between an assistant that answers and one that helps.
 *
 * The tree is expressed with `parentId` rather than a `children` array. A
 * parent holding its children means loading a life goal loads everything
 * beneath it, and the depth is unbounded; a parent key keeps every node
 * constant-size and lets the tree be assembled only when it is actually needed.
 */
export interface Goal {
  readonly id: GoalId;
  readonly userId: UserId;
  /** One line, in the user's words where possible. Enters the prompt directly. */
  readonly description: string;
  readonly status: GoalStatus;
  readonly horizon: GoalHorizon;
  readonly origin: GoalOrigin;
  readonly priority: Priority;
  /**
   * How far along, 0–1.
   *
   * Independent of `status`: a goal can be 0.9 complete and `blocked`, and
   * collapsing the two into one field loses exactly the case worth surfacing.
   */
  readonly progress: Progress;
  readonly createdAt: Timestamp;
  readonly updatedAt: Timestamp;
  /** Null when open-ended. Most goals are. */
  readonly dueAt: Timestamp | null;
  /** Null when terminal state has not been reached. */
  readonly completedAt: Timestamp | null;
  /** The goal this one serves, or null for a root. */
  readonly parentId: GoalId | null;
  /**
   * Goals that must reach a terminal state first.
   *
   * A list of ids, not of goals — a dependency graph that embedded its nodes
   * would be recursive and unserialisable, and cycles would be undetectable
   * until something tried to walk it.
   */
  readonly dependsOn: readonly GoalId[];
  /**
   * Why the companion believes this is a goal, when `origin` is not
   * `user_stated`.
   *
   * Required for anything inferred, because a companion acting on a goal the
   * user never set must be able to show its work when challenged.
   */
  readonly rationale: string | null;
  readonly metadata: Metadata;
}

/**
 * A goal with its immediate children resolved.
 *
 * A read model, assembled on demand — never persisted and never stored on
 * `Goal` itself. Kept shallow (one level) because rendering a plan needs a
 * parent and its steps, not an arbitrarily deep tree, and unbounded recursion
 * here would reintroduce exactly the cost `parentId` avoids.
 */
export interface GoalTree {
  readonly goal: Goal;
  readonly children: readonly Goal[];
}

/**
 * Caps how many goals may be active at once.
 *
 * Not storage pressure — attention pressure. Every active goal competes for the
 * `goals` section of the context budget, so an unbounded list means each goal
 * gets a few tokens and none of them usefully influence anything.
 */
export const MAX_ACTIVE_GOALS = 12;
