import type { ActionId, ActionType, DecisionId } from '@nexa/models';
import type { EventEnvelope } from '../../interfaces/envelope.js';
import { defineEvent } from '../../interfaces/envelope.js';

/**
 * Facts about what the companion was asked to do, and what happened.
 *
 * `nexa.action.generated` is the accepted spelling of the brief's
 * `ActionCreated`; it shipped in Milestone 1 and is emitted by `@nexa/core`
 * today. `nexa.action.executed` covers `ActionCompleted`.
 *
 * The generated/executed split matters because the two happen in different
 * places. Generation is the backend's; execution is the *client's*, reported
 * back. ADR-001 makes Unity a client, so the backend genuinely does not know
 * whether an action ran until it is told — and `action.executed` arriving with
 * `success: false` is normal, not exceptional.
 */

export interface ActionGeneratedPayload {
  readonly actionId: ActionId;
  readonly actionType: ActionType;
  readonly decisionId: DecisionId;
}

export interface ActionStartedPayload {
  readonly actionId: ActionId;
  readonly actionType: ActionType;
  /** Which client began it. Several may be attached to one companion. */
  readonly clientId: string;
}

export interface ActionExecutedPayload {
  readonly actionId: ActionId;
  readonly actionType: ActionType;
  readonly success: boolean;
  readonly clientId: string;
  readonly durationMs: number;
}

export interface ActionFailedPayload {
  readonly actionId: ActionId;
  readonly actionType: ActionType;
  readonly clientId: string;
  readonly reason: string;
}

/**
 * An action was refused before it left the backend.
 *
 * Distinct from failure: rejection happens in validation, so the client never
 * saw it. Rejected actions are dropped and reported rather than failing the
 * turn — one malformed gesture must not cost the user the answer that came with
 * it — and this event is what makes that silent degradation visible.
 */
export interface ActionRejectedPayload {
  readonly actionType: ActionType | 'unknown';
  readonly reason: 'schema' | 'safety' | 'permission' | 'budget';
  readonly detail: string;
}

export const actionGenerated = defineEvent<'nexa.action.generated', ActionGeneratedPayload>(
  'nexa.action.generated',
  1,
  { source: 'turn' },
);

export const actionStarted = defineEvent<'nexa.action.started', ActionStartedPayload>(
  'nexa.action.started',
  1,
  { source: 'client' },
);

export const actionExecuted = defineEvent<'nexa.action.executed', ActionExecutedPayload>(
  'nexa.action.executed',
  1,
  { source: 'client' },
);

export const actionFailed = defineEvent<'nexa.action.failed', ActionFailedPayload>(
  'nexa.action.failed',
  1,
  { source: 'client' },
);

export const actionRejected = defineEvent<'nexa.action.rejected', ActionRejectedPayload>(
  'nexa.action.rejected',
  1,
  { source: 'turn' },
);

export type ActionEvent =
  | EventEnvelope<'nexa.action.generated', ActionGeneratedPayload>
  | EventEnvelope<'nexa.action.started', ActionStartedPayload>
  | EventEnvelope<'nexa.action.executed', ActionExecutedPayload>
  | EventEnvelope<'nexa.action.failed', ActionFailedPayload>
  | EventEnvelope<'nexa.action.rejected', ActionRejectedPayload>;

export const ACTION_EVENTS = [
  actionGenerated,
  actionStarted,
  actionExecuted,
  actionFailed,
  actionRejected,
] as const;
