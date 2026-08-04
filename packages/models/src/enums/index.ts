/**
 * The domain's closed vocabularies.
 *
 * Every one is a string-literal union with an `as const` companion array rather
 * than a TypeScript `enum`. Three reasons, in order of weight:
 *
 * 1. A union is erased at compile time. An `enum` emits a runtime object, which
 *    means importing one for a *type* pulls JavaScript into the bundle and
 *    breaks under `isolatedModules` + `verbatimModuleSyntax` — both enabled here.
 * 2. The values are what is persisted. `'episodic'` in the database, in the
 *    event log, and in the code are the same token, so there is no mapping
 *    layer to get wrong.
 * 3. `satisfies` keeps the companion array exhaustive: adding a union member
 *    without adding it to the array is a compile error, so the runtime list
 *    cannot silently fall out of step.
 */
export type { MemoryType, MemorySource, ForgetReason } from './memory.js';
export { MEMORY_TYPES, MEMORY_SOURCES, FORGET_REASONS } from './memory.js';

export type { EmotionType, EmotionSubject, EmotionOrigin } from './emotion.js';
export { EMOTION_TYPES, EMOTION_SUBJECTS, EMOTION_ORIGINS } from './emotion.js';

export type { GoalStatus, GoalHorizon, GoalOrigin } from './goal.js';
export {
  GOAL_STATUSES,
  GOAL_HORIZONS,
  GOAL_ORIGINS,
  TERMINAL_GOAL_STATUSES,
  isTerminalGoalStatus,
} from './goal.js';

export type {
  RelationshipType,
  RelationshipDimension,
  CommunicationStyle,
} from './relationship.js';
export {
  RELATIONSHIP_TYPES,
  RELATIONSHIP_DIMENSIONS,
  COMMUNICATION_STYLES,
  RELATIONSHIP_RANK,
  compareRelationships,
} from './relationship.js';

export type { ConversationState, MessageRole, ConversationTrigger } from './conversation.js';
export {
  CONVERSATION_STATES,
  MESSAGE_ROLES,
  CONVERSATION_TRIGGERS,
  isOpenConversation,
} from './conversation.js';

export type { ToolType, ToolEffect, ToolInvocationStatus } from './tool.js';
export {
  TOOL_TYPES,
  TOOL_EFFECTS,
  TOOL_INVOCATION_STATUSES,
  isRetryable,
  requiresConfirmation,
} from './tool.js';

export type { TaskStepStatus } from './plan.js';
export { TASK_STEP_STATUSES, isSettledStep } from './plan.js';

export type { WorldObjectType, SpaceType, ObservationState } from './world.js';
export { WORLD_OBJECT_TYPES, SPACE_TYPES, OBSERVATION_STATES, isPresent } from './world.js';

export type { VoiceSessionState, VoiceEndReason, AudioRoute } from './voice.js';
export {
  VOICE_SESSION_STATES,
  VOICE_END_REASONS,
  AUDIO_ROUTES,
  isCapturing,
  isVoiceSessionOver,
} from './voice.js';
