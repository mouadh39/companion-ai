/**
 * Stage 0 — who is allowed to start a turn, and when.
 *
 * Everything here exists because a turn is not the only turn. Two devices, a
 * retrying client, and a caller who has already given up are all ordinary, and
 * each corrupts something different if unhandled: concurrent turns corrupt
 * working memory, retries duplicate side effects, and an expired turn spends a
 * provider call on an answer nobody will read.
 */
export type { TurnGate, ReleaseTurn } from './gate.js';
export { InProcessTurnGate } from './gate.js';

export type { IdempotencyStore, IdempotencyOptions } from './idempotency.js';
export { InMemoryIdempotencyStore, defaultIdempotencyOptions } from './idempotency.js';
