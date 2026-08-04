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
export type { TraitName, TraitScores, AdaptiveState, PersonalityProfile } from './identity.js';
export { TRAIT_NAMES, isValidPersonality, defaultPersonality } from './identity.js';

export type {
  IdentityProfile,
  IdentityValue,
  ValueId,
  Commitment,
  CommitmentKind,
  AutonomyPrinciple,
  CertaintyBand,
  UncertaintyStance,
  CapabilityStatement,
  CapabilityDomain,
  CapabilityMaturity,
  LimitationStatement,
  LimitationKind,
  KnowledgeBoundary,
  BoundaryStance,
  IdentityInvariant,
} from './identity-profile.js';
export {
  VALUE_IDS,
  COMMITMENT_KINDS,
  CERTAINTY_BANDS,
  CAPABILITY_DOMAINS,
  CAPABILITY_MATURITIES,
  LIMITATION_KINDS,
  BOUNDARY_STANCES,
} from './identity-profile.js';

export type {
  SelfQuestion,
  SelfStance,
  IdentityClaim,
  SelfAnswer,
  IntroductionContext,
  IntroductionElement,
  IntroductionPlan,
} from './self-description.js';
export {
  SELF_QUESTIONS,
  SELF_STANCES,
  INTRODUCTION_CONTEXTS,
  INTRODUCTION_ELEMENTS,
} from './self-description.js';

export type {
  ExpressionProfile,
  DetailLevel,
  InitiativeLevel,
  Pacing,
  ExpressionReasonCode,
  ExpressionReason,
  ExpressionDimension,
} from './expression.js';
export {
  DETAIL_LEVELS,
  DETAIL_RANK,
  INITIATIVE_LEVELS,
  INITIATIVE_RANK,
  PACINGS,
  PACING_RANK,
  EXPRESSION_REASON_CODES,
  EXPRESSION_DIMENSIONS,
  isValidExpression,
} from './expression.js';

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

export type { TaskStep, TaskPlan } from './plan.js';
export { activeStep, blockedSteps } from './plan.js';

export type {
  Memory,
  RetrievedMemory,
  RankingSignals,
  MemoryCandidate,
} from './memory.js';

export type {
  MemorySubject,
  MemoryProposal,
  MemoryDraft,
  Reinforcement,
  FormationRejection,
  FormationReasonCode,
  FormationReason,
  FormationDecision,
  ForgetDecision,
} from './memory-formation.js';
export {
  MEMORY_SUBJECTS,
  FORMATION_REJECTIONS,
  FORMATION_REASON_CODES,
} from './memory-formation.js';

export type {
  InsightKind,
  InsightStatus,
  InsightCertainty,
  InsightPolarity,
  InsightKey,
  InsightEvidence,
  InsightProvenance,
  InsightChangeKind,
  InsightChange,
  Insight,
  InsightDraft,
  InsightAdjustment,
  InsightRetirement,
  ReflectionDecline,
  ReflectionReasonCode,
  ReflectionReason,
  InsightDecision,
  ReflectionResult,
} from './reflection.js';
export {
  INSIGHT_KINDS,
  INSIGHT_STATUSES,
  INSIGHT_CERTAINTIES,
  CERTAINTY_RANK,
  INSIGHT_POLARITIES,
  INSIGHT_CHANGE_KINDS,
  INSIGHT_RETIREMENTS,
  REFLECTION_DECLINES,
  REFLECTION_REASON_CODES,
  insightKey,
} from './reflection.js';

export type {
  Objective,
  Strategy,
  PlanConstraint,
  AdviceStance,
  EmotionalHandling,
  UncertaintyHandling,
  ClarificationReason,
  ClarificationNeed,
  FollowUpKind,
  FollowUpWhen,
  FollowUp,
  MemoryOpportunity,
  PlanHorizon,
  PlanReasonCode,
  PlanReason,
  Consideration,
  StrategyBlock,
  StrategyEvaluation,
  ConversationPlan,
} from './planning.js';
export {
  OBJECTIVES,
  STRATEGIES,
  STRATEGY_PRIORITY,
  PLAN_CONSTRAINTS,
  ADVICE_STANCES,
  EMOTIONAL_HANDLINGS,
  CLARIFICATION_REASONS,
  FOLLOW_UP_KINDS,
  FOLLOW_UP_WHENS,
  PLAN_HORIZONS,
  PLAN_REASON_CODES,
} from './planning.js';

export type {
  PerceptChannel,
  Percept,
  TextPercept,
  ObservationFamily,
  ObservationDimension,
  ObservationStance,
  Stance,
  EvidenceKind,
  ObservationEvidence,
  Observation,
  UnknownReason,
  UnknownDimension,
  Tension,
  Reference,
  PerceptionReasonCode,
  PerceptionReason,
  PerceptionOutcome,
} from './observation.js';
export {
  PERCEPT_CHANNELS,
  OBSERVATION_FAMILIES,
  OBSERVATION_DIMENSIONS,
  OBSERVATION_STANCES,
  STANCES,
  EVIDENCE_KINDS,
  UNKNOWN_REASONS,
  PERCEPTION_REASON_CODES,
} from './observation.js';

export type {
  RetrievalClass,
  Durability,
  SignalName,
  RelevanceSignals,
  RetrievalReasonCode,
  RetrievalReason,
  RetrievalSource,
  RetrievalItem,
  ExclusionReason,
  ExcludedCandidate,
  RetrievalBudget,
  BudgetSpend,
  DegradationReason,
  Degradation,
  RetrievalOutcome,
} from './retrieval.js';
export {
  RETRIEVAL_CLASSES,
  DURABILITIES,
  SIGNAL_NAMES,
  ANCHOR_SIGNALS,
  RETRIEVAL_REASON_CODES,
  RETRIEVAL_SOURCES,
  EXCLUSION_REASONS,
  DEGRADATION_REASONS,
} from './retrieval.js';

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

export type {
  Relationship,
  RelationshipDimensions,
  RelationshipCounters,
} from './relationship.js';
export {
  MAX_DIMENSION_DELTA_PER_INTERACTION,
  initialRelationshipDimensions,
  initialCounters,
} from './relationship.js';

export type {
  RelationshipProfile,
  PersonalizationLevel,
  InteractionCadence,
  BlockerKind,
  StageBlocker,
  RelationshipReasonCode,
  RelationshipReason,
  InteractionSignal,
  RelationshipUpdate,
  StageChange,
} from './relationship-profile.js';
export {
  PERSONALIZATION_LEVELS,
  PERSONALIZATION_RANK,
  INTERACTION_CADENCES,
  BLOCKER_KINDS,
  RELATIONSHIP_REASON_CODES,
} from './relationship-profile.js';

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
