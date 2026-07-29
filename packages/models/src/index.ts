/**
 * `@nexa/models` — the domain vocabulary.
 *
 * Data and its invariants only. Nothing here performs I/O, reads a clock, or
 * knows how it will be stored: these types are shared by the API process, the
 * worker, and every capability package, so a dependency added here is a
 * dependency added everywhere.
 */
export type {
  Identity,
  TraitName,
  TraitScores,
  AdaptiveState,
  PersonalityProfile,
} from './identity.js';
export { isValidPersonality, defaultPersonality } from './identity.js';

export type {
  IntentKind,
  IntentCandidate,
  UserEmotion,
  EmotionSignal,
  Perception,
} from './perception.js';
export { primaryIntent } from './perception.js';

export type {
  MemoryType,
  MemorySource,
  Memory,
  RetrievedMemory,
  RetrievalSignals,
  MemoryCandidate,
} from './memory.js';

export type { DecisionKind, ReasonCode, Decision } from './decision.js';
export { DECISION_PRIORITY, compareDecisionKinds } from './decision.js';

export type {
  ContextSection,
  OmissionReason,
  SectionOmission,
  ContextBudget,
  ConversationTurn,
  CognitiveContext,
} from './context.js';
export { isDegraded, totalSpent, defaultBudget } from './context.js';
