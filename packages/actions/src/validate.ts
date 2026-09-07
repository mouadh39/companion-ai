import { type Result, err, ok } from '@nexa/shared';
import {
  MAX_ACTIONS_PER_TURN,
  MAX_SPEAK_LENGTH,
  type Action,
  type ActionType,
  type DistanceUnit,
  type RejectionReason,
} from '@nexa/models';

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
      if (!Number.isFinite(action.duration) || action.duration < 0) {
        return reject('schema', 'Wait duration must be a non-negative, finite number.');
      }
      if (action.duration > 30_000) {
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

    case 'call_tool': {
      // The tool's own JSON Schema governs the arguments; the registry checks
      // them against it. What is verifiable here is that a tool was actually
      // named — an empty id is a generation failure, not a permission question.
      if (action.toolId.trim().length === 0) {
        return reject('schema', 'Tool action names no tool.');
      }
      return ok(action);
    }

    case 'move': {
      // A movement naming neither a destination nor a direction says nothing at
      // all, and a body asked to move nowhere in particular would have to invent
      // somewhere. This is the one invariant the type cannot express, because
      // each field is independently legitimate on its own.
      if (action.target === null && action.direction === null) {
        return reject('schema', 'Move action names neither a target nor a direction.');
      }

      // Target-relative directions are meaningless without the target they are
      // relative to. "Move closer" to nothing is not a smaller movement, it is
      // an unanswerable one.
      if (
        (action.direction === 'toward' || action.direction === 'away_from') &&
        action.target === null
      ) {
        return reject(
          'schema',
          `Direction '${action.direction}' is relative to a target, but none was given.`,
        );
      }

      const distanceFault = validateDistance(action.distance, action.distanceUnit);
      if (distanceFault !== null) return reject(distanceFault.reason, distanceFault.detail);

      return ok(action);
    }

    case 'follow': {
      // Unlike `move`, a follow with no target is not merely underspecified —
      // there is no egocentric fallback that means anything. Following in a
      // direction is just walking.
      if (typeof action.target !== 'string' || action.target.trim().length === 0) {
        return reject('schema', 'Follow action names no target.');
      }

      if (action.distance !== null) {
        if (!Number.isFinite(action.distance) || action.distance <= 0) {
          return reject('schema', 'Follow distance must be a positive, finite number.');
        }
        if (action.distance > MAX_FOLLOW_DISTANCE_METRES) {
          return reject(
            'budget',
            `Follow distance is ${String(action.distance)} m; the limit is ${String(MAX_FOLLOW_DISTANCE_METRES)} m.`,
          );
        }
      }

      return ok(action);
    }

    case 'gesture':
    case 'look':
    case 'stop':
      // All three are closed enums; the compiler has already constrained them.
      return ok(action);
  }
};

/**
 * The furthest a single instruction may send the companion, in metres.
 *
 * Not a navigation limit — the client's own pathfinding owns that. This catches
 * a generation that produced a number with the wrong magnitude, which is a
 * failure mode worth naming: "move back 200" is far more likely to be a model
 * that meant centimetres than a genuine request to leave the building.
 */
const MAX_DISTANCE_METRES = 50;

/** Steps are bounded lower, because a step is a much larger unit than a metre. */
const MAX_DISTANCE_STEPS = 20;

/** How far behind the companion may be asked to trail, in metres. */
const MAX_FOLLOW_DISTANCE_METRES = 10;

interface DistanceFault {
  readonly reason: RejectionReason;
  readonly detail: string;
}

/**
 * Checks a distance and its unit together.
 *
 * The two are validated as a pair rather than separately because either one
 * alone is incoherent: a number with no unit cannot be acted on, and a unit
 * with no number describes nothing. Modelling them as one nested object would
 * have made this structural, but the wire format is deliberately flat — see
 * `MoveAction` — so the pairing is enforced here instead.
 */
const validateDistance = (
  distance: number | null,
  unit: DistanceUnit | null,
): DistanceFault | null => {
  if (distance === null && unit === null) return null;

  if (distance === null || unit === null) {
    return {
      reason: 'schema',
      detail: 'Distance and its unit must be given together or not at all.',
    };
  }

  if (!Number.isFinite(distance) || distance <= 0) {
    return { reason: 'schema', detail: 'Distance must be a positive, finite number.' };
  }

  const ceiling = unit === 'steps' ? MAX_DISTANCE_STEPS : MAX_DISTANCE_METRES;
  if (distance > ceiling) {
    return {
      reason: 'budget',
      detail: `Distance is ${String(distance)} ${unit}; the limit is ${String(ceiling)}.`,
    };
  }

  return null;
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
