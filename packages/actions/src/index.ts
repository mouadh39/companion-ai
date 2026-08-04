/**
 * `@nexa/actions` — validation for the vocabulary clients execute.
 *
 * The companion never returns text for a client to interpret. It returns
 * actions, and this package is what guarantees an action leaving the backend is
 * well-formed.
 *
 * The action *types* live in `@nexa/models`, one layer below, because they are
 * domain language rather than behaviour — and because `@nexa/events` and
 * `@nexa/core` both need to name an action without depending on its validator.
 * They are re-exported here so existing importers are unaffected.
 */
export type {
  SpeakAction,
  GestureAction,
  LookAction,
  WaitAction,
  RememberAction,
  CallToolAction,
  Action,
  ActionType,
  ActionOfType,
  SpeechTone,
  GestureKind,
  LookTarget,
} from '@nexa/models';
export type { RejectionReason } from '@nexa/models';
export { MAX_ACTIONS_PER_TURN, MAX_SPEAK_LENGTH, REJECTION_REASONS } from '@nexa/models';

export type { ActionRejection, ValidationOutcome } from './validate.js';
export { validateAction, validateActions } from './validate.js';
