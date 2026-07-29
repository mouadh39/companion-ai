/**
 * `@nexa/actions` — the vocabulary clients execute.
 *
 * The companion never returns text for a client to interpret. It returns
 * actions, and this package is the whole of that contract.
 */
export type {
  SpeakAction,
  GestureAction,
  LookAction,
  WaitAction,
  RememberAction,
  Action,
  ActionType,
  ActionOfType,
} from './action.js';
export { MAX_ACTIONS_PER_TURN, MAX_SPEAK_LENGTH } from './action.js';

export type { RejectionReason, ActionRejection, ValidationOutcome } from './validate.js';
export { validateAction, validateActions } from './validate.js';
