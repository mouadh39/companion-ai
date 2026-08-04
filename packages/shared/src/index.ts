/**
 * `@nexa/shared` — pure primitives with no domain knowledge and no dependencies.
 *
 * The contract for this package is deliberately narrow, because the alternative
 * has a name: a `utils` package, which accretes whatever has no other home and
 * quietly becomes a coupling point between modules that should not know about
 * each other. Anything added here must be dependency-free, domain-free, and
 * individually justified.
 */
export type { Result } from './result.js';
export {
  ok,
  err,
  isOk,
  isErr,
  map,
  flatMap,
  unwrapOr,
  attempt,
  attemptAsync,
} from './result.js';

export type {
  CompanionId,
  UserId,
  TurnId,
  EventId,
  MemoryId,
  InsightId,
  DecisionId,
  ActionId,
  GoalId,
  ConversationId,
  MessageId,
  RelationshipId,
  WorldObjectId,
  VoiceSessionId,
  PlanId,
  SessionId,
  ToolId,
} from './ids.js';
export {
  uuidv7,
  newTurnId,
  newEventId,
  newMemoryId,
  newInsightId,
  newDecisionId,
  newActionId,
  newGoalId,
  newConversationId,
  newMessageId,
  newRelationshipId,
  newWorldObjectId,
  newVoiceSessionId,
  newPlanId,
  newSessionId,
  trustExternalId,
} from './ids.js';

export type { Clock } from './clock.js';
export { systemClock, FixedClock } from './clock.js';

export {
  NexaError,
  ValidationError,
  ConfigurationError,
  PortTimeoutError,
  ProviderError,
} from './errors.js';
