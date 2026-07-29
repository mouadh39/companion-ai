import type { CompanionId, ProviderError, Result, UserId } from '@nexa/shared';
import type {
  CognitiveContext,
  ConversationTurn,
  Identity,
  MemoryCandidate,
  Perception,
  PersonalityProfile,
  RetrievedMemory,
} from '@nexa/models';

/**
 * The ports.
 *
 * Core declares these; capability packages implement them; the composition root
 * wires them. That direction is what keeps `@nexa/core` free of any dependency
 * on `@nexa/memory`, `@nexa/personality`, and the rest — the orchestrator
 * depends on an interface it owns, and every implementation points inward at
 * the same interface.
 *
 * The alternative — Core importing each capability — makes Core a hub that must
 * change whenever any capability changes, and impossible to test without
 * standing up the entire system.
 */

/** Turns a raw message into a `Perception`. Cheap and local by design. */
export interface PerceptionPort {
  perceive(text: string): Promise<Perception>;
}

export interface IdentityPort {
  load(companionId: CompanionId): Promise<Identity>;
}

export interface PersonalityPort {
  load(companionId: CompanionId): Promise<PersonalityProfile>;
}

/**
 * The current session's exchanges. Bounded, ephemeral, never the system of
 * record — anything worth keeping is promoted to long-term memory by the worker.
 */
export interface WorkingMemoryPort {
  recent(companionId: CompanionId, limit: number): Promise<readonly ConversationTurn[]>;
  append(companionId: CompanionId, turn: ConversationTurn): Promise<void>;
}

export interface RetrievalQuery {
  readonly companionId: CompanionId;
  readonly userId: UserId;
  readonly perception: Perception;
  readonly goals: readonly string[];
  /** Upper bound from the context budget. Retrieval must respect it. */
  readonly maxResults: number;
}

/**
 * Ranked memory retrieval.
 *
 * Returns memories *with their scores and signals*, because "why did you bring
 * that up?" is only answerable if the ranking survives the call.
 */
export interface MemoryRetrievalPort {
  retrieve(query: RetrievalQuery): Promise<readonly RetrievedMemory[]>;
}

/** Records a candidate memory for asynchronous scoring and persistence. */
export interface MemoryWritePort {
  propose(companionId: CompanionId, candidate: MemoryCandidate): Promise<void>;
}

export interface GoalPort {
  active(companionId: CompanionId): Promise<readonly string[]>;
}

export interface ToolRegistryPort {
  available(companionId: CompanionId): Promise<readonly string[]>;
}

/** One message in a provider request. */
export interface ModelMessage {
  readonly role: 'user' | 'assistant';
  readonly content: string;
}

export interface CompletionRequest {
  readonly system: string;
  readonly messages: readonly ModelMessage[];
  readonly maxTokens: number;
}

export interface CompletionResult {
  readonly text: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  /** Which model actually served the request. May differ from the one asked for. */
  readonly model: string;
  /** True when the provider declined on policy grounds rather than failing. */
  readonly refused: boolean;
}

/**
 * The language model, behind one interface.
 *
 * ADR-002 in one type: the companion's identity, memory, goals and personality
 * all live outside this boundary, so swapping the implementation changes which
 * model writes the words and nothing else about who is speaking.
 *
 * Returns a `Result` rather than throwing — a provider failure is an expected
 * condition on a path that must degrade rather than fail.
 */
export interface LanguageModelPort {
  readonly name: string;
  complete(request: CompletionRequest): Promise<Result<CompletionResult, ProviderError>>;
}

/**
 * Estimates the token cost of a string.
 *
 * A port because the honest implementation is provider-specific — Anthropic's
 * `count_tokens` for Claude, a different tokeniser elsewhere — and because the
 * budget is only as trustworthy as this number.
 */
export interface TokenEstimatorPort {
  estimate(text: string): number;
}

/** Everything the assembler reads from. Grouped so wiring is one object. */
export interface ContextPorts {
  readonly identity: IdentityPort;
  readonly personality: PersonalityPort;
  readonly workingMemory: WorkingMemoryPort;
  readonly memoryRetrieval: MemoryRetrievalPort;
  readonly goals: GoalPort;
  readonly tools: ToolRegistryPort;
  readonly tokens: TokenEstimatorPort;
}

/** Produces actions from a decision. Implemented in Core; a port for testability. */
export interface ActionGeneratorPort {
  generate(context: CognitiveContext, decisionKind: string): Promise<unknown>;
}
