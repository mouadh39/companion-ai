/**
 * What kind of capability a tool provides.
 *
 * Categorised by *consequence*, not by vendor. `calendar` and `email` are
 * separate members not because they are different products but because one
 * writes to a schedule and the other sends something irreversible to a third
 * party. Permission prompts, confirmation policy and audit weight all key off
 * this, and a taxonomy organised by integration would put "reads the weather"
 * and "sends a message to your boss" in the same bucket the moment both arrived
 * through one provider.
 */
export type ToolType =
  | 'calendar'
  | 'email'
  | 'messaging'
  | 'search'
  | 'navigation'
  | 'media'
  | 'smart_home'
  | 'weather'
  | 'file'
  | 'system';

export const TOOL_TYPES = [
  'calendar',
  'email',
  'messaging',
  'search',
  'navigation',
  'media',
  'smart_home',
  'weather',
  'file',
  'system',
] as const satisfies readonly ToolType[];

/**
 * What invoking a tool does to the world.
 *
 * The single most important field on a tool. A `read` may be retried freely
 * after a timeout; an `external` one may not, because the message was probably
 * sent and the caller simply did not hear back. Nexa's event delivery is
 * at-least-once (`06_Event_System.md`), which makes "is this safe to run twice?"
 * a question the domain must answer rather than a judgement call at the retry
 * site.
 */
export type ToolEffect = 'read' | 'write' | 'external' | 'destructive';

export const TOOL_EFFECTS = [
  'read',
  'write',
  'external',
  'destructive',
] as const satisfies readonly ToolEffect[];

/** True when the effect is safe to repeat after an ambiguous failure. */
export const isRetryable = (effect: ToolEffect): boolean => effect === 'read';

/** True when the effect requires explicit user confirmation before invocation. */
export const requiresConfirmation = (effect: ToolEffect): boolean =>
  effect === 'external' || effect === 'destructive';

/**
 * The outcome of one invocation.
 *
 * `denied` is distinct from `failed`: a refused permission is a fact about the
 * user's boundaries and should be remembered, whereas a failure is noise worth
 * retrying. Treating them alike produces a companion that either nags or gives
 * up permanently after one flaky call.
 */
export type ToolInvocationStatus = 'succeeded' | 'failed' | 'denied' | 'timed_out';

export const TOOL_INVOCATION_STATUSES = [
  'succeeded',
  'failed',
  'denied',
  'timed_out',
] as const satisfies readonly ToolInvocationStatus[];
