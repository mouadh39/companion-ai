import type { EventDraft } from '../interfaces/envelope.js';
import type { TurnEvent } from './turn/index.js';
import type { DecisionEvent } from './decision/index.js';
import type { ConversationEvent } from './conversation/index.js';
import type { MemoryEvent } from './memory/index.js';
import type { GoalEvent } from './goals/index.js';
import type { EmotionEvent } from './emotions/index.js';
import type { RelationshipEvent } from './relationship/index.js';
import type { PerceptionEvent } from './perception/index.js';
import type { PlanEvent } from './planning/index.js';
import type { ReflectionEvent } from './reflection/index.js';
import type { ActionEvent } from './actions/index.js';
import type { ToolEvent } from './tools/index.js';
import type { WorldEvent } from './world/index.js';
import type { SystemEvent } from './system/index.js';

import { TURN_EVENTS } from './turn/index.js';
import { DECISION_EVENTS } from './decision/index.js';
import { CONVERSATION_EVENTS } from './conversation/index.js';
import { MEMORY_EVENTS } from './memory/index.js';
import { GOAL_EVENTS } from './goals/index.js';
import { EMOTION_EVENTS } from './emotions/index.js';
import { RELATIONSHIP_EVENTS } from './relationship/index.js';
import { PERCEPTION_EVENTS } from './perception/index.js';
import { PLAN_EVENTS } from './planning/index.js';
import { REFLECTION_EVENTS } from './reflection/index.js';
import { ACTION_EVENTS } from './actions/index.js';
import { TOOL_EVENTS } from './tools/index.js';
import { WORLD_EVENTS } from './world/index.js';
import { SYSTEM_EVENTS } from './system/index.js';

/**
 * The discriminated union of everything on the bus.
 *
 * `subscribe` narrows the payload from the type string alone, so a handler
 * never casts. **If a cast is needed, this union is wrong.**
 *
 * Assembled from per-domain unions rather than listed flat, so adding an event
 * touches one domain file and nothing else. A new engine adds a directory, a
 * union member here, and a line in `ALL_EVENT_DEFINITIONS` — three edits, none
 * of which any existing handler can notice.
 */
export type DomainEvent =
  | TurnEvent
  | DecisionEvent
  | ConversationEvent
  | MemoryEvent
  | GoalEvent
  | EmotionEvent
  | RelationshipEvent
  | PerceptionEvent
  | PlanEvent
  | ReflectionEvent
  | ActionEvent
  | ToolEvent
  | WorldEvent
  | SystemEvent;

export type DomainEventType = DomainEvent['type'];

/** Narrows the union to the single member matching `T`. */
export type EventOfType<T extends DomainEventType> = Extract<DomainEvent, { type: T }>;

/**
 * Any draft the bus will accept.
 *
 * `unknown` for the payload rather than the payload union, because a publisher
 * has already been type-checked by the factory that produced the draft. Keeping
 * it open here is what lets `publishAll` take a heterogeneous batch without a
 * cast at every call site.
 */
export type AnyEventDraft = EventDraft<DomainEventType, unknown>;

/**
 * Every event definition, for the registry.
 *
 * The one place the catalogue is enumerable at runtime. Kept beside the union
 * so a domain added to one and forgotten in the other is visible in a single
 * file rather than discovered when a replay hits an unknown type.
 */
export const ALL_EVENT_DEFINITIONS = [
  ...TURN_EVENTS,
  ...DECISION_EVENTS,
  ...CONVERSATION_EVENTS,
  ...MEMORY_EVENTS,
  ...GOAL_EVENTS,
  ...EMOTION_EVENTS,
  ...RELATIONSHIP_EVENTS,
  ...PERCEPTION_EVENTS,
  ...PLAN_EVENTS,
  ...REFLECTION_EVENTS,
  ...ACTION_EVENTS,
  ...TOOL_EVENTS,
  ...WORLD_EVENTS,
  ...SYSTEM_EVENTS,
] as const;

export * from './turn/index.js';
export * from './decision/index.js';
export * from './conversation/index.js';
export * from './memory/index.js';
export * from './goals/index.js';
export * from './emotions/index.js';
export * from './relationship/index.js';
export * from './perception/index.js';
export * from './planning/index.js';
export * from './reflection/index.js';
export * from './actions/index.js';
export * from './tools/index.js';
export * from './world/index.js';
export * from './system/index.js';
