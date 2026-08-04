import type { CompanionId, ProviderError, Result, ToolId, UserId } from '@nexa/shared';
import type {
  JsonObject,
  ConversationTurn,
  DecisionHint,
  EmotionState,
  ExpressionProfile,
  Goal,
  IdentityProfile,
  MemoryCandidate,
  Perception,
  PersonalityProfile,
  TaskPlan,
  Relationship,
  RetrievedMemory,
  Tool,
  WorldSnapshot,
} from '@nexa/models';
import type { PortOptions } from './execution/index.js';

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
 *
 * ## Tiers
 *
 * Ports are grouped by their relationship to the turn's latency path, not by
 * which engine owns them, because that relationship is what determines timeout
 * policy, failure policy, and whether a failure may be degraded. Grouped by
 * owning engine, those three answers get re-derived once per port and drift.
 *
 * - **Tier 1 — context.** Read-only, called in parallel during assembly,
 *   individually budgeted, degradable. Must be free of side effects: they run
 *   under a race that can abandon a slow result, so a Tier 1 port that writes
 *   is a port that writes non-deterministically.
 * - **Tier 2 — generation.** Sequential, on the critical path, recoverable then
 *   turn-fatal.
 * - **Tier 3 — egress.** Runs after the answer exists, so it can never fail a
 *   turn and never returns a value the turn uses.
 *
 * Voice and vision are deliberately absent. They sit outside the turn: speech
 * recognition produces the request, speech synthesis renders the response, and
 * vision writes into the world model asynchronously. A port for either would
 * make Core aware of the client's output modality, which is the coupling the
 * whole design exists to prevent.
 */

/** Turns a raw message into a `Perception`. Cheap and local by design. */
export interface PerceptionPort {
  perceive(text: string, options: PortOptions): Promise<Perception>;
}

// ── Tier 1 · context ────────────────────────────────────────────────────────

/**
 * Loads the canonical self-definition.
 *
 * Still a port even though `@nexa/identity` serves a frozen constant. The port
 * is what keeps Core from importing that package, and it leaves room for a
 * deployment whose companions differ — the turn asks "who is this companion?"
 * and does not care that today every answer is the same object.
 */
export interface IdentityPort {
  load(companionId: CompanionId, options: PortOptions): Promise<IdentityProfile>;
}

export interface PersonalityPort {
  load(companionId: CompanionId, options: PortOptions): Promise<PersonalityProfile>;
}

/**
 * What the expression engine needs to compose a turn's delivery.
 *
 * Declared here rather than imported from `@nexa/personality`, because Core
 * declaring a shape it needs is the whole point of the dependency rule — the
 * adapter in the composition root maps this onto whatever the engine's own
 * request type happens to be, and the engine can change that type without Core
 * knowing.
 *
 * `preferences` is deliberately absent: no port supplies the user record yet,
 * and inventing a default here would assert something about the user that
 * nothing has established.
 */
export interface ExpressionRequest {
  readonly personality: PersonalityProfile;
  readonly perception: Perception;
  readonly relationship: Relationship | null;
  readonly recentTurns: readonly ConversationTurn[];
}

/**
 * Composes how the companion should communicate this turn.
 *
 * Tier 1, and optional. A companion with no expression capability composed in is
 * not degraded — generation reads the raw traits instead, which is what it did
 * before this port existed.
 *
 * Async like every other port despite the reference implementation being a pure
 * function. The uniformity is worth more than the microseconds: it means this
 * port is budgeted, cancellable and recorded by the same `callPort` machinery as
 * everything else, and an implementation that later needs to read something is
 * not a signature change.
 */
export interface ExpressionPort {
  compose(request: ExpressionRequest, options: PortOptions): Promise<ExpressionProfile>;
}

/**
 * The current session's exchanges. Bounded, ephemeral, never the system of
 * record — anything worth keeping is promoted to long-term memory by the worker.
 *
 * `append` is the turn's one mutation and belongs to the commit stage, not to
 * assembly; it is on this interface only because both halves address the same
 * store.
 */
export interface WorkingMemoryPort {
  recent(
    companionId: CompanionId,
    limit: number,
    options: PortOptions,
  ): Promise<readonly ConversationTurn[]>;
  append(
    companionId: CompanionId,
    turn: ConversationTurn,
    options: PortOptions,
  ): Promise<void>;
}

export interface RetrievalQuery {
  readonly companionId: CompanionId;
  readonly userId: UserId;
  readonly perception: Perception;
  readonly goals: readonly Goal[];
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
  retrieve(query: RetrievalQuery, options: PortOptions): Promise<readonly RetrievedMemory[]>;
}

export interface GoalPort {
  active(companionId: CompanionId, options: PortOptions): Promise<readonly Goal[]>;
}

export interface ToolRegistryPort {
  available(companionId: CompanionId, options: PortOptions): Promise<readonly Tool[]>;
}

/** What the turn asks the world model for. Scoped, never "everything". */
export interface WorldQuery {
  readonly companionId: CompanionId;
  /**
   * Entities named in the message, so the world capability can prioritise.
   *
   * "Where are my keys" should not have to scan the room to find that keys
   * were mentioned.
   */
  readonly entities: readonly string[];
  /** Upper bound from the context budget. The world model must respect it. */
  readonly maxObjects: number;
}

/**
 * A snapshot of what the companion believes is around the user.
 *
 * The read half of the world model, and the only half the turn touches. Vision
 * writes the other half continuously and asynchronously — at 30–60 Hz it cannot
 * be a turn-scoped call, which is why there is no `VisionPort` here.
 */
export interface WorldPort {
  snapshot(query: WorldQuery, options: PortOptions): Promise<WorldSnapshot>;
}

/**
 * The companion's current read of the user's emotional state.
 *
 * Read-only. Updating the state after a turn is a subscriber's job, not Core's:
 * a write port here would make Core own the update rules for an engine it
 * should not know the internals of.
 */
export interface EmotionPort {
  current(
    companionId: CompanionId,
    userId: UserId,
    options: PortOptions,
  ): Promise<EmotionState | null>;
}

/** The relationship record. Read-only, for the same reason as `EmotionPort`. */
export interface RelationshipPort {
  current(
    companionId: CompanionId,
    userId: UserId,
    options: PortOptions,
  ): Promise<Relationship | null>;
}

/**
 * The plan as it currently stands.
 *
 * Split from plan *revision* deliberately. Reading is cheap, cacheable, and
 * belongs in assembly; revising is expensive, conditional on the decision, and
 * runs in the worker. One `PlanningPort` doing both would put multi-step goal
 * decomposition on the path of every "how was your day?".
 */
export interface PlanReadPort {
  current(companionId: CompanionId, options: PortOptions): Promise<TaskPlan | null>;
}

/** Everything an advisor sees. A read-only projection of what assembly produced. */
export interface DecisionAdviceRequest {
  readonly perception: Perception;
  readonly workingMemory: readonly ConversationTurn[];
  readonly retrievedMemories: readonly RetrievedMemory[];
  readonly goals: readonly Goal[];
  readonly emotion: EmotionState | null;
  readonly world: WorldSnapshot | null;
}

/**
 * Forms an advisory opinion on what the companion should do.
 *
 * Runs in the **last assembly wave**, before deliberation, so that its output
 * is an input to a pure function rather than a call made from inside one. That
 * placement is the entire design: it is what lets a model participate in
 * deciding without costing replay, determinism, or structural explainability.
 *
 * Optional by construction. With no advisor composed in, deliberation runs on
 * its rules alone and nothing else changes.
 */
export interface DecisionAdvisorPort {
  advise(
    request: DecisionAdviceRequest,
    options: PortOptions,
  ): Promise<DecisionHint | null>;
}

// ── Tier 3 · egress ─────────────────────────────────────────────────────────

/**
 * Records a candidate memory for asynchronous scoring and persistence.
 *
 * `propose`, not `store`: Core never decides what is worth remembering
 * long-term, only that something might be. Scoring and consolidation belong to
 * the worker, and the user must never wait on either.
 */
export interface MemoryWritePort {
  propose(
    companionId: CompanionId,
    candidate: MemoryCandidate,
    options: PortOptions,
  ): Promise<void>;
}

// ── Tier 2 · generation ─────────────────────────────────────────────────────

/** A tool the model asked to invoke. */
export interface ModelToolCall {
  /**
   * The provider's id for this call.
   *
   * Threaded through unchanged so the result can be matched back to the request
   * — a model may ask for three tools in one turn, and the pairing is the
   * provider's, not ours to invent.
   */
  readonly callId: string;
  readonly toolId: ToolId;
  readonly arguments: JsonObject;
}

/** What a tool produced, in the form the model reads back. */
export interface ToolOutcome {
  readonly callId: string;
  /** Rendered for the model. A tool that returns structure serialises it here. */
  readonly content: string;
  /**
   * True when the tool failed.
   *
   * Reported to the model rather than thrown, because a failed tool is
   * information the companion can act on — it can say the calendar is
   * unreachable instead of falling silent.
   */
  readonly isError: boolean;
}

/**
 * One message in a provider request.
 *
 * A union rather than a flat `{role, content}` because the tool loop needs to
 * send back what the model asked for and what came of it. Collapsing tool
 * results into user-role prose is how a conversation ends up containing
 * fabricated user turns that the model then treats as things the person said.
 */
export type ModelMessage =
  | { readonly role: 'user'; readonly content: string }
  | {
      readonly role: 'assistant';
      readonly content: string;
      readonly toolCalls: readonly ModelToolCall[];
    }
  | { readonly role: 'tool'; readonly results: readonly ToolOutcome[] };

export interface CompletionRequest {
  readonly system: string;
  readonly messages: readonly ModelMessage[];
  readonly maxTokens: number;
  /** Offered to the model. Empty when none are available or none are usable. */
  readonly tools: readonly Tool[];
}

export interface CompletionResult {
  readonly text: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  /**
   * Prompt tokens served from the provider's cache.
   *
   * The only observable signal that prompt caching is working. Without it, a
   * prompt reordering that silently defeats the cache shows up as a bill rather
   * than as a metric.
   */
  readonly cachedInputTokens: number;
  /** Which model actually served the request. May differ from the one asked for. */
  readonly model: string;
  /** True when the provider declined on policy grounds rather than failing. */
  readonly refused: boolean;
  /** Tools the model wants invoked before it can answer. Empty when it is done. */
  readonly toolCalls: readonly ModelToolCall[];
}

/**
 * What a provider can do.
 *
 * This is what makes "local models without redesigning Core" true rather than
 * aspirational. A 7B running on-device may have no tool use; without this, Core
 * offers it tools, gets prose back, and the failure surfaces as a companion
 * that mysteriously never uses its calendar. With it, the loop is skipped and a
 * diagnostic is recorded — degradation, which is the policy everywhere else.
 */
export interface ModelCapabilities {
  readonly toolUse: boolean;
  readonly streaming: boolean;
  /** Should govern the assembler's total token limit rather than a constant. */
  readonly contextWindow: number;
  readonly promptCaching: boolean;
}

/** Receives text as the provider produces it. */
export type TokenSink = (chunk: string) => void;

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
  readonly capabilities: ModelCapabilities;
  complete(
    request: CompletionRequest,
    options: PortOptions,
  ): Promise<Result<CompletionResult, ProviderError>>;
  /**
   * Streams the response, calling `sink` as text arrives.
   *
   * Optional, and the resolved value is the same `CompletionResult` `complete`
   * returns — streaming changes when the caller learns the answer, never what
   * the answer is. A provider without it simply omits it, and generation falls
   * back to `complete` with no other change.
   */
  stream?(
    request: CompletionRequest,
    sink: TokenSink,
    options: PortOptions,
  ): Promise<Result<CompletionResult, ProviderError>>;
}

/**
 * Runs one tool.
 *
 * Deliberately separate from `ToolRegistryPort`. Listing tools is cheap, local,
 * and safe to run in parallel during assembly; running one is expensive,
 * side-effecting, and needs its own authorisation and audit. A single
 * `ToolPort` doing both would make the read path inherit the write path's risk
 * — and the read path is the one called on every single turn.
 */
export interface ToolExecutionPort {
  execute(
    request: ToolExecutionRequest,
    options: PortOptions,
  ): Promise<Result<ToolOutcome, Error>>;
}

export interface ToolExecutionRequest {
  readonly companionId: CompanionId;
  readonly callId: string;
  readonly toolId: ToolId;
  readonly arguments: JsonObject;
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

/**
 * Everything the assembler reads from. Grouped so wiring is one object.
 *
 * The optional half is optional *by capability*, not by preference. A port that
 * is absent contributes nothing and records nothing — no omission, no
 * degradation. That distinction matters: a companion with no world model is not
 * a degraded companion, it is one without that faculty. Marking it degraded
 * would flag every turn until every engine ships and destroy the one metric
 * that tracks quality in a system built to fail quietly.
 */
export interface ContextPorts {
  readonly identity: IdentityPort;
  readonly personality: PersonalityPort;
  readonly workingMemory: WorkingMemoryPort;
  readonly memoryRetrieval: MemoryRetrievalPort;
  readonly goals: GoalPort;
  readonly tools: ToolRegistryPort;
  readonly tokens: TokenEstimatorPort;

  readonly world?: WorldPort;
  readonly emotion?: EmotionPort;
  readonly relationship?: RelationshipPort;
  readonly plan?: PlanReadPort;
  readonly decisionAdvisor?: DecisionAdvisorPort;
  /**
   * Composes delivery from personality, relationship and the moment.
   *
   * Optional so that a deployment without it behaves exactly as the system did
   * before the personality engine existed — the prompt reads raw traits and
   * tone falls back to the heuristic in generation.
   */
  readonly expression?: ExpressionPort;
}

