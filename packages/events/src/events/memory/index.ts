import type {
  ConfidenceScore,
  ForgetReason,
  ImportanceScore,
  MemoryId,
  MemorySource,
  MemoryType,
} from '@nexa/models';
import type { EventEnvelope } from '../../interfaces/envelope.js';
import { defineEvent } from '../../interfaces/envelope.js';

/**
 * Facts about what the companion now knows, or has stopped knowing.
 *
 * Type strings follow the accepted `Event_API.md` catalogue, which the
 * Milestone 3 brief named differently in two places: `MemoryCreated` is
 * `nexa.memory.stored`, and `MemoryDeleted` is `nexa.memory.forgotten` with
 * `reason: 'user_request'`. Renaming a type already in an append-only log would
 * split every historical query across two names for no gain.
 *
 * Every payload here carries identifiers and the facts that changed, never the
 * `Memory` object. Fat events couple the consumer to the producer's schema, and
 * a consumer that needs the whole record loads it through a port.
 */

export interface MemoryCandidateCreatedPayload {
  readonly candidateId: string;
  readonly memoryType: MemoryType;
  readonly summary: string;
}

export interface MemoryStoredPayload {
  readonly memoryId: MemoryId;
  readonly memoryType: MemoryType;
  readonly importance: ImportanceScore;
  readonly source: MemorySource;
}

export interface MemoryUpdatedPayload {
  readonly memoryId: MemoryId;
  /** Which fields changed. Names only — the values are loaded through a port. */
  readonly changed: readonly string[];
  readonly confidence: ConfidenceScore;
}

/**
 * Emitted *after* a retrieval port call, as an audit fact.
 *
 * Not a request. "Retrieve memories for this context" is a port — the turn
 * needs the answer, and `06_Event_System.md` is explicit that anything the
 * caller waits on is not an event. This records what was returned so the
 * companion can later account for why it said what it said.
 */
export interface MemoryRetrievedPayload {
  readonly memoryIds: readonly MemoryId[];
  readonly scores: readonly number[];
  readonly queryKind: string;
}

export interface MemoryConsolidatedPayload {
  readonly resultId: MemoryId;
  readonly mergedIds: readonly MemoryId[];
}

/**
 * A memory left active circulation.
 *
 * Emitted for user-requested deletion too, so the audit trail records that a
 * deletion happened even once the memory itself is gone. A companion whose
 * history can be silently rewritten cannot be trusted, and
 * `18_Memory_Architecture.md` makes user trust a success criterion.
 */
export interface MemoryForgottenPayload {
  readonly memoryId: MemoryId;
  readonly reason: ForgetReason;
}

export const memoryCandidateCreated = defineEvent<
  'nexa.memory.candidate.created',
  MemoryCandidateCreatedPayload
>('nexa.memory.candidate.created', 1, { source: 'memory' });

export const memoryStored = defineEvent<'nexa.memory.stored', MemoryStoredPayload>(
  'nexa.memory.stored',
  1,
  { source: 'memory' },
);

export const memoryUpdated = defineEvent<'nexa.memory.updated', MemoryUpdatedPayload>(
  'nexa.memory.updated',
  1,
  { source: 'memory' },
);

export const memoryRetrieved = defineEvent<'nexa.memory.retrieved', MemoryRetrievedPayload>(
  'nexa.memory.retrieved',
  1,
  { source: 'memory' },
);

export const memoryConsolidated = defineEvent<
  'nexa.memory.consolidated',
  MemoryConsolidatedPayload
>('nexa.memory.consolidated', 1, { source: 'memory' });

export const memoryForgotten = defineEvent<'nexa.memory.forgotten', MemoryForgottenPayload>(
  'nexa.memory.forgotten',
  1,
  { source: 'memory' },
);

export type MemoryEvent =
  | EventEnvelope<'nexa.memory.candidate.created', MemoryCandidateCreatedPayload>
  | EventEnvelope<'nexa.memory.stored', MemoryStoredPayload>
  | EventEnvelope<'nexa.memory.updated', MemoryUpdatedPayload>
  | EventEnvelope<'nexa.memory.retrieved', MemoryRetrievedPayload>
  | EventEnvelope<'nexa.memory.consolidated', MemoryConsolidatedPayload>
  | EventEnvelope<'nexa.memory.forgotten', MemoryForgottenPayload>;

export const MEMORY_EVENTS = [
  memoryCandidateCreated,
  memoryStored,
  memoryUpdated,
  memoryRetrieved,
  memoryConsolidated,
  memoryForgotten,
] as const;
