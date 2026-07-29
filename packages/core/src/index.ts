/**
 * `@nexa/core` — the ports, the cognitive turn, and the pure deliberator.
 *
 * Core declares the interfaces; capability packages implement them; the
 * composition root wires them. Core never imports a capability package, so the
 * intelligence's *shape* stays testable without standing up the system.
 */
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
  CompletionRequest,
  CompletionResult,
  LanguageModelPort,
  TokenEstimatorPort,
  ContextPorts,
  ActionGeneratorPort,
} from './ports.js';

export type { AssemblyRequest, AssemblerOptions } from './context-assembler.js';
export { ContextAssembler, defaultAssemblerOptions } from './context-assembler.js';

export type { DecisionDraft } from './deliberator.js';
export { deliberate } from './deliberator.js';

export { ActionGenerator, buildSystemPrompt, buildMessages } from './action-generator.js';

export type {
  TurnRequest,
  TurnResult,
  TurnFailure,
  CognitiveTurnDependencies,
} from './cognitive-turn.js';
export { CognitiveTurn } from './cognitive-turn.js';
