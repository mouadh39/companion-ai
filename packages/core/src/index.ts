/**
 * `@nexa/core` — the ports, the cognitive turn, and the pure deliberator.
 *
 * Core declares the interfaces; capability packages implement them; the
 * composition root wires them. Core never imports a capability package, so the
 * intelligence's *shape* stays testable without standing up the system.
 */
// `PortOutcome`, `PortCallRecord` and the diagnostic vocabulary are not
// re-exported: they live in `@nexa/models` now, and a second export path would
// let two names for one type drift apart in consumers' imports.
export type { PortOptions, PortCall, TurnBudget } from './execution/index.js';
export {
  Deadline,
  callPort,
  defaultTurnBudget,
  omissionReasonFor,
  toRecord,
} from './execution/index.js';

export {
  CapabilityConflictError,
  CapabilityCycleError,
  ContextUnavailableError,
  ContributorCycleError,
  MissingCapabilityError,
  TurnAbortedError,
  UnknownContributorError,
} from './errors.js';

export type {
  PortMap,
  PortKey,
  CapabilityContext,
  CapabilityLogger,
  CapabilityInstance,
  CapabilityModule,
  AnyCapabilityModule,
  ConfigParser,
  HealthState,
  HealthStatus,
  CapabilityRegistration,
  CapabilitySet,
} from './capability/index.js';
export {
  healthy,
  silentLogger,
  bootCapabilities,
  planInitOrder,
} from './capability/index.js';

export type {
  ContributorKey,
  ContributionRequest,
  ContributorView,
  ContextContribution,
  AnyContribution,
  ContributionWaves,
  ContributionRun,
} from './context/index.js';
export { contributorKey, planWaves, runContributions } from './context/index.js';

export type {
  PerceptionPort,
  IdentityPort,
  PersonalityPort,
  WorkingMemoryPort,
  RetrievalQuery,
  MemoryRetrievalPort,
  MemoryWritePort,
  GoalPort,
  ToolRegistryPort,
  ModelMessage,
  ModelToolCall,
  ToolOutcome,
  CompletionRequest,
  CompletionResult,
  ModelCapabilities,
  TokenSink,
  EmbeddingPort,
  LanguageModelPort,
  ToolExecutionPort,
  ToolExecutionRequest,
  TokenEstimatorPort,
  ContextPorts,
  ExpressionPort,
  ExpressionRequest,
  WorldQuery,
  WorldPort,
  EmbodimentPort,
  ActionOutcomePort,
  SelfModelPort,
  SelfModelRequest,
  EmotionPort,
  RelationshipPort,
  PlanReadPort,
  DecisionAdviceRequest,
  DecisionAdvisorPort,
} from './ports.js';

export type {
  AssemblyRequest,
  AssemblerOptions,
  AssemblyOutcome,
} from './context-assembler.js';
export {
  ContextAssembler,
  defaultAssemblerOptions,
  IDENTITY,
  PERSONALITY,
  GOALS,
  WORKING_MEMORY,
  RETRIEVED_MEMORIES,
  TOOLS,
  WORLD,
  BODY,
  SELF,
  EMOTION,
  RELATIONSHIP,
  PLAN,
  DECISION_HINT,
  EXPRESSION,
} from './context-assembler.js';

export { TurnRecordBuilder } from './turn-record.js';

export type {
  Metrics,
  MetricLabels,
  Span,
  Tracer,
  Logger,
  LogLevel,
  Observability,
  RecordedMetric,
  RecordedLog,
} from './observability/index.js';
export {
  noopMetrics,
  noopTracer,
  noopLogger,
  noopObservability,
  RecordingMetrics,
  RecordingLogger,
  TURN_METRICS,
  reportTurn,
} from './observability/index.js';

export type {
  TurnGate,
  ReleaseTurn,
  IdempotencyStore,
  IdempotencyOptions,
} from './admission/index.js';
export {
  InProcessTurnGate,
  InMemoryIdempotencyStore,
  defaultIdempotencyOptions,
} from './admission/index.js';

export type { DecisionDraft } from './deliberator.js';
export { deliberate } from './deliberator.js';

export type { ActionGeneratorDependencies } from './action-generator.js';
export { ActionGenerator, buildSystemPrompt, buildMessages } from './action-generator.js';

export type {
  GenerationDiagnostic,
  GenerationOutcome,
  ToolLoopLimits,
  ToolLoopDependencies,
  ToolLoopRequest,
  TurnSink,
} from './generation/index.js';
export {
  runToolLoop,
  defaultToolLoopLimits,
  toneFor,
  deliver,
} from './generation/index.js';

export type {
  TurnRequest,
  TurnResult,
  TurnFailure,
  CognitiveTurnDependencies,
} from './cognitive-turn.js';
export { CognitiveTurn } from './cognitive-turn.js';
