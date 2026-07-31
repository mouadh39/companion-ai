/**
 * The things the domain is about.
 *
 * Interfaces, not classes. An entity here is a description of a shape that is
 * persisted, replayed and sent over a wire; behaviour that operates on these
 * lives in the capability packages above. That separation is what lets
 * `deliberate()` stay a pure function of its input — a context assembled from
 * objects with methods would be a context whose replay depends on which code
 * version rehydrated it.
 */
export type { Identity, TraitName, TraitScores, AdaptiveState, PersonalityProfile } from './identity.js';
export { TRAIT_NAMES, isValidPersonality, defaultPersonality } from './identity.js';

export type {
  IntentKind,
  IntentCandidate,
  UserEmotion,
  EmotionSignal,
  Perception,
} from './perception.js';
export { INTENT_KINDS, USER_EMOTIONS, primaryIntent } from './perception.js';

export type { DecisionKind, ReasonCode, Decision, DecisionHint } from './decision.js';
export {
  DECISION_KINDS,
  REASON_CODES,
  DECISION_PRIORITY,
  MIN_ACTIONABLE_HINT_CONFIDENCE,
  compareDecisionKinds,
} from './decision.js';

export type { ClientCapabilities } from './client-capabilities.js';
export {
  UNRESTRICTED_CLIENT,
  VOICE_ONLY_CLIENT,
  canRender,
} from './client-capabilities.js';

export type { WorldSnapshot } from './world-snapshot.js';

export type { PlanStep, PlanSnapshot } from './plan.js';
export { activeStep, blockedSteps } from './plan.js';

export type {
  Memory,
  RetrievedMemory,
  RetrievalSignals,
  MemoryCandidate,
} from './memory.js';

export type {
  ContextSection,
  OmissionReason,
  SectionOmission,
  ContextBudget,
  ConversationTurn,
  CognitiveContext,
} from './context.js';
export {
  CONTEXT_SECTIONS,
  OMISSION_REASONS,
  isDegraded,
  totalSpent,
  defaultBudget,
} from './context.js';

export type { User, UserPreferences, CompanionBinding } from './user.js';
export { defaultPreferences } from './user.js';

export type { Conversation, ConversationSummary } from './conversation.js';
export { IDLE_AFTER_MS, END_AFTER_IDLE_MS } from './conversation.js';

export type {
  Message,
  UserMessage,
  CompanionMessage,
  SystemMessage,
  ToolMessage,
  MessageOfRole,
} from './message.js';
export { MAX_MESSAGE_LENGTH, isVisibleToUser } from './message.js';

export type { Goal, GoalTree } from './goal.js';
export { MAX_ACTIVE_GOALS } from './goal.js';

export type { EmotionState, EmotionTransition } from './emotion.js';
export {
  EMOTION_DECAY_PER_HOUR,
  MIN_ACTIONABLE_EMOTION_CONFIDENCE,
  neutralEmotion,
} from './emotion.js';

export type { Relationship, RelationshipDimensions } from './relationship.js';
export {
  MAX_DIMENSION_DELTA_PER_INTERACTION,
  initialRelationshipDimensions,
} from './relationship.js';

export type {
  Action,
  ActionType,
  ActionOfType,
  SpeakAction,
  GestureAction,
  LookAction,
  WaitAction,
  RememberAction,
  CallToolAction,
  SpeechTone,
  GestureKind,
  LookTarget,
  RejectionReason,
} from './action.js';
export {
  ACTION_TYPES,
  SPEECH_TONES,
  GESTURE_KINDS,
  LOOK_TARGETS,
  REJECTION_REASONS,
  MAX_ACTIONS_PER_TURN,
  MAX_SPEAK_LENGTH,
} from './action.js';

export type {
  TurnStage,
  TurnSource,
  TurnOutcome,
  PortOutcome,
  PortCallRecord,
  DiagnosticCode,
  DiagnosticSeverity,
  Diagnostic,
  ModelCall,
  RejectedActionRecord,
  TurnRecord,
} from './turn-record.js';
export {
  TURN_STAGES,
  TURN_SOURCES,
  PORT_OUTCOMES,
  DIAGNOSTIC_CODES,
} from './turn-record.js';

export type { EventAggregate } from './event.js';
export { EVENT_AGGREGATES, aggregateOf, DELIVERY_GUARANTEE } from './event.js';

export type { Tool, ToolInvocation } from './tool.js';

export type { WorldObject, Space } from './world-object.js';
export { OBSERVATION_FRESHNESS_MS, MIN_REFERENCEABLE_CONFIDENCE } from './world-object.js';

export type { VoiceSession, Transcript } from './voice-session.js';
export {
  END_OF_UTTERANCE_SILENCE_MS,
  SESSION_SILENCE_TIMEOUT_MS,
  MIN_ACTIONABLE_TRANSCRIPT_CONFIDENCE,
} from './voice-session.js';
