/**
 * The domain's quantities and small immutable values.
 *
 * A value object here is a *branded primitive plus its invariant*, not a class.
 * Classes would give these identity and methods; both are wrong for values that
 * must round-trip through JSON unchanged and compare by content. The brand
 * costs nothing at runtime and makes substituting one quantity for another a
 * compile error rather than a plausible-looking bug.
 */
export type {
  ConfidenceScore,
  ImportanceScore,
  Priority,
  Progress,
  Valence,
} from './score.js';
export {
  confidence,
  importance,
  priority,
  progress,
  valence,
  parseUnit,
  parseValence,
  clampUnit,
  PRIORITY,
} from './score.js';

export type { Timestamp, Duration } from './timestamp.js';
export {
  timestamp,
  parseTimestamp,
  duration,
  between,
  compareTimestamps,
} from './timestamp.js';

export type { EmbeddingReference } from './embedding-reference.js';
export { isComparable } from './embedding-reference.js';

export type { Coordinate, SpatialFrame, SpatialPosition } from './coordinate.js';
export { distance, ORIGIN } from './coordinate.js';

export type { Metadata, MetadataValue } from './metadata.js';
export { EMPTY_METADATA, MAX_METADATA_KEYS, isMetadata } from './metadata.js';

export type { Identifier } from './identifier.js';
export { isUuidV7, isToolId } from './identifier.js';
export type {
  CompanionId,
  UserId,
  TurnId,
  EventId,
  MemoryId,
  DecisionId,
  ActionId,
  GoalId,
  ConversationId,
  MessageId,
  RelationshipId,
  WorldObjectId,
  VoiceSessionId,
  ToolId,
} from './identifier.js';
