/**
 * Execution primitives shared by every stage of the turn.
 *
 * Kept apart from the stages themselves because they encode policy that must
 * be identical everywhere — how long a call may take, how it is cancelled, and
 * how its failure is classified. A stage that invented its own answer to any of
 * those is a stage that degrades differently from the rest of the pipeline.
 */
export { Deadline } from './deadline.js';

export type { TurnBudget } from './budget.js';
export { defaultTurnBudget } from './budget.js';

export type { PortOptions, PortCall } from './port-call.js';
export { callPort, omissionReasonFor, toRecord } from './port-call.js';
