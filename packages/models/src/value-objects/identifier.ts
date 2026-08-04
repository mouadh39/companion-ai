/**
 * Identity, re-exported rather than redefined.
 *
 * The branded identifier types live in `@nexa/shared`, one layer below this
 * package, because `apps/backend` and the transport layer need to name a
 * `UserId` without importing the entire domain vocabulary. Redefining them here
 * would produce two brands with the same name and no assignability between
 * them — the exact failure the brand exists to prevent.
 *
 * They are surfaced through `@nexa/models` because domain code should have one
 * import for the domain's language. That makes this module a facade, and the
 * single source of truth stays in `shared`.
 */
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
} from '@nexa/shared';

import type {
  ActionId,
  CompanionId,
  ConversationId,
  DecisionId,
  EventId,
  GoalId,
  MemoryId,
  MessageId,
  RelationshipId,
  ToolId,
  TurnId,
  UserId,
  VoiceSessionId,
  WorldObjectId,
} from '@nexa/shared';

/**
 * Every identifier the domain uses.
 *
 * Lets a generic mechanism — an audit record, a cache key, a permission check —
 * accept "any Nexa id" without widening to `string` and losing the brand at the
 * first boundary it crosses.
 */
export type Identifier =
  | CompanionId
  | UserId
  | TurnId
  | EventId
  | MemoryId
  | DecisionId
  | ActionId
  | GoalId
  | ConversationId
  | MessageId
  | RelationshipId
  | WorldObjectId
  | VoiceSessionId
  | ToolId;

/**
 * Every identifier is a UUID v7 except `ToolId`, which is a registry name.
 *
 * v7 sorts chronologically, so an id column is also a time index — see
 * `uuidv7` in `@nexa/shared` for why that matters to the event log.
 */
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const isUuidV7 = (value: string): boolean => UUID_V7.test(value);

/**
 * A tool's registry name: `namespace.operation`, lower-case.
 *
 * Constrained because these names are written into prompts and matched against
 * model output. A tool called `Calendar Create Event` is one the model will
 * reproduce inconsistently, and a mismatch there reads as the tool not existing.
 */
const TOOL_NAME = /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)+$/;

export const isToolId = (value: string): boolean => TOOL_NAME.test(value);
