import type { ActionId, ToolEffect, ToolId, ToolInvocationStatus } from '@nexa/models';
import type { EventEnvelope } from '../../interfaces/envelope.js';
import { defineEvent } from '../../interfaces/envelope.js';

/**
 * Facts about capability invocations.
 *
 * **`ToolRequested` from the brief is deliberately absent.** Asking a tool to
 * run and waiting for the answer is a port call: the turn needs the result to
 * continue, and `06_Event_System.md` gives the test — if you need the return
 * value, it is not an event. Emitting a request event and correlating a
 * response event back to it is a synchronous call reimplemented badly, with no
 * stack trace when it breaks.
 *
 * What remains are genuine facts, emitted around the port call by whoever made
 * it. `nexa.tool.executed` is the accepted spelling of `ToolCompleted`.
 *
 * `effect` rides on every event because at-least-once delivery makes "is this
 * safe to have happened twice?" a question consumers must be able to answer
 * from the event alone.
 */

export interface ToolStartedPayload {
  readonly toolId: ToolId;
  readonly actionId: ActionId;
  readonly effect: ToolEffect;
}

export interface ToolExecutedPayload {
  readonly toolId: ToolId;
  readonly actionId: ActionId;
  readonly effect: ToolEffect;
  readonly success: boolean;
  readonly durationMs: number;
}

/**
 * An invocation did not succeed.
 *
 * `status` distinguishes the cases that call for different responses. A
 * `denied` result is a fact about the user's boundaries and should change
 * future behaviour; a `timed_out` one is noise worth retrying. Collapsing them
 * produces a companion that either nags or gives up permanently after one flaky
 * call.
 */
export interface ToolFailedPayload {
  readonly toolId: ToolId;
  readonly actionId: ActionId;
  readonly effect: ToolEffect;
  readonly status: Exclude<ToolInvocationStatus, 'succeeded'>;
  readonly error: string;
  /** False for `external` and `destructive` effects — the call may have landed. */
  readonly retryable: boolean;
}

export const toolStarted = defineEvent<'nexa.tool.started', ToolStartedPayload>(
  'nexa.tool.started',
  1,
  { source: 'tools' },
);

export const toolExecuted = defineEvent<'nexa.tool.executed', ToolExecutedPayload>(
  'nexa.tool.executed',
  1,
  { source: 'tools' },
);

export const toolFailed = defineEvent<'nexa.tool.failed', ToolFailedPayload>(
  'nexa.tool.failed',
  1,
  { source: 'tools' },
);

export type ToolEvent =
  | EventEnvelope<'nexa.tool.started', ToolStartedPayload>
  | EventEnvelope<'nexa.tool.executed', ToolExecutedPayload>
  | EventEnvelope<'nexa.tool.failed', ToolFailedPayload>;

export const TOOL_EVENTS = [toolStarted, toolExecuted, toolFailed] as const;
