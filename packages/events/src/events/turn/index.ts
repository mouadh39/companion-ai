import type { TurnSource, TurnStage } from '@nexa/models';
import type { EventEnvelope } from '../../interfaces/envelope.js';
import { defineEvent } from '../../interfaces/envelope.js';

/**
 * Turn lifecycle.
 *
 * The turn itself is a **synchronous pipeline**, not a chain of these events —
 * `05_Data_Flow.md` and `06_Event_System.md` both fix that, and Milestone 3
 * confirmed it. These are emitted *by* the pipeline as it runs, so anything
 * downstream can observe a turn without participating in it. Nothing in the
 * turn waits on a handler; deleting every subscriber would change latency and
 * nothing else.
 *
 * Not in the Milestone 3 brief's directory list, but the three events here
 * shipped in Milestone 1 and are consumed by `@nexa/core` today. They needed a
 * home that matched the new layout.
 */

/**
 * Re-exported from `@nexa/models`, where the stage vocabulary now lives.
 *
 * It moved because three packages name a stage and only one of them is about
 * events. The alias stays so existing importers of `@nexa/events` are
 * unaffected — a rename here would break two consumers for no behavioural gain.
 */
export type { TurnStage, TurnSource } from '@nexa/models';

export interface TurnStartedPayload {
  readonly source: TurnSource;
  readonly intent: string | null;
}

export interface TurnCompletedPayload {
  readonly actionCount: number;
  readonly durationMs: number;
  /** True when any context section was dropped or a port timed out. */
  readonly degraded: boolean;
}

export interface TurnFailedPayload {
  readonly stage: TurnStage;
  readonly reason: string;
}

export const turnStarted = defineEvent<'nexa.turn.started', TurnStartedPayload>(
  'nexa.turn.started',
  1,
  { source: 'turn' },
);

export const turnCompleted = defineEvent<'nexa.turn.completed', TurnCompletedPayload>(
  'nexa.turn.completed',
  1,
  { source: 'turn' },
);

export const turnFailed = defineEvent<'nexa.turn.failed', TurnFailedPayload>(
  'nexa.turn.failed',
  1,
  { source: 'turn' },
);

export type TurnEvent =
  | EventEnvelope<'nexa.turn.started', TurnStartedPayload>
  | EventEnvelope<'nexa.turn.completed', TurnCompletedPayload>
  | EventEnvelope<'nexa.turn.failed', TurnFailedPayload>;

export const TURN_EVENTS = [turnStarted, turnCompleted, turnFailed] as const;
