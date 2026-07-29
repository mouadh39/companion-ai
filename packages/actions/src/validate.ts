import { type Result, err, ok } from '@nexa/shared';
import {
  MAX_ACTIONS_PER_TURN,
  MAX_SPEAK_LENGTH,
  type Action,
  type ActionType,
} from './action.js';

export type RejectionReason = 'schema' | 'safety' | 'permission' | 'budget';

export interface ActionRejection {
  readonly actionType: ActionType | 'unknown';
  readonly reason: RejectionReason;
  readonly detail: string;
}

/**
 * Validates a single action.
 *
 * A client must never be the first thing to discover an action is malformed.
 * By the time an action leaves the backend it has been checked here, so a
 * client-side failure means a protocol bug rather than a bad generation.
 */
export const validateAction = (action: Action): Result<Action, ActionRejection> => {
  const reject = (reason: RejectionReason, detail: string): Result<never, ActionRejection> =>
    err({ actionType: action.type, reason, detail });

  switch (action.type) {
    case 'speak': {
      const text = action.text.trim();
      if (text.length === 0) {
        return reject('schema', 'Speak action carries no text.');
      }
      if (action.text.length > MAX_SPEAK_LENGTH) {
        return reject(
          'budget',
          `Speak action is ${action.text.length} characters; the limit is ${MAX_SPEAK_LENGTH}.`,
        );
      }
      return ok(action);
    }

    case 'wait': {
      if (!Number.isFinite(action.durationMs) || action.durationMs < 0) {
        return reject('schema', 'Wait duration must be a non-negative, finite number.');
      }
      if (action.durationMs > 30_000) {
        return reject('budget', 'Wait exceeds the 30s ceiling.');
      }
      return ok(action);
    }

    case 'remember': {
      if (action.content.trim().length === 0) {
        return reject('schema', 'Remember action carries no content.');
      }
      if (action.importance < 0 || action.importance > 1) {
        return reject('schema', 'Importance must be within 0–1.');
      }
      return ok(action);
    }

    case 'gesture':
    case 'look':
      // Both are closed enums; the compiler has already constrained them.
      return ok(action);
  }
};

export interface ValidationOutcome {
  readonly accepted: readonly Action[];
  readonly rejected: readonly ActionRejection[];
}

/**
 * Validates a turn's actions as a batch.
 *
 * Rejected actions are dropped and reported rather than failing the turn: one
 * malformed gesture should not cost the user the answer that came with it. The
 * turn degrades, which is the behaviour `docs/architecture/05_Data_Flow.md`
 * requires throughout.
 */
export const validateActions = (actions: readonly Action[]): ValidationOutcome => {
  const accepted: Action[] = [];
  const rejected: ActionRejection[] = [];

  for (const action of actions) {
    if (accepted.length >= MAX_ACTIONS_PER_TURN) {
      rejected.push({
        actionType: action.type,
        reason: 'budget',
        detail: `Turn already holds ${MAX_ACTIONS_PER_TURN} actions.`,
      });
      continue;
    }

    const result = validateAction(action);
    if (result.ok) {
      accepted.push(result.value);
    } else {
      rejected.push(result.error);
    }
  }

  return { accepted, rejected };
};
