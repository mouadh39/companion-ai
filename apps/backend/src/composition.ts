import { systemClock, type Clock } from '@nexa/shared';
import { InProcessEventBus, type EventBus } from '@nexa/events';
import {
  ActionGenerator,
  CognitiveTurn,
  ContextAssembler,
  InMemoryIdempotencyStore,
  InProcessTurnGate,
  RecordingMetrics,
  noopObservability,
  type ContextPorts,
  type IdempotencyStore,
  type LanguageModelPort,
  type Observability,
  type TurnGate,
  type TurnResult,
} from '@nexa/core';
import {
  AnthropicLanguageModel,
  HeuristicTokenEstimator,
  ScriptedLanguageModel,
} from '@nexa/providers';
import type { AppConfig } from './config.js';
import { HeuristicPerception } from './adapters/perception.js';
import {
  EmptyMemoryRetrieval,
  InMemoryPersonality,
  InMemoryWorkingMemory,
  NoGoals,
  NoTools,
  RecordingMemoryWrite,
  StaticIdentity,
} from './adapters/in-memory.js';

/**
 * The composition root.
 *
 * **This is the only place in the system that names a concrete implementation.**
 * Core declares ports; capability packages implement them; everything meets
 * here. That is what makes swapping a provider, a memory store, or an entire
 * transport a change to this file rather than a change to the intelligence.
 *
 * It mirrors the rule already enforced in the Unity client, where `Nexa.App` is
 * the sole assembly permitted to name concrete AR types.
 *
 * Composition proceeds in layers, and the order is the dependency order:
 *
 * ```
 *   config → infrastructure → capabilities → core → transports
 * ```
 *
 * Capabilities that do not exist yet simply have no adapter here. Their ports
 * are optional on `ContextPorts`, so an absent one contributes nothing and
 * records nothing — a companion with no world model is not a degraded
 * companion, it is one without that faculty.
 */

export interface Application {
  readonly turn: CognitiveTurn;
  readonly events: EventBus;
  readonly clock: Clock;
  readonly modelName: string;
  /**
   * Exposed for tests to assert on, and as the seam a `/metrics` surface will
   * read from. No such route exists yet — the recorder is in-process only.
   */
  readonly metrics: RecordingMetrics;
  shutdown(): Promise<void>;
}

export interface CompositionOverrides {
  readonly clock?: Clock;
  readonly languageModel?: LanguageModelPort;
  readonly observability?: Observability;
}

const selectLanguageModel = (
  config: AppConfig,
  overrides: CompositionOverrides,
): LanguageModelPort => {
  if (overrides.languageModel !== undefined) return overrides.languageModel;

  if (config.provider === 'anthropic' && config.anthropicApiKey !== null) {
    return new AnthropicLanguageModel({
      apiKey: config.anthropicApiKey,
      model: config.modelId,
      effort: 'low',
    });
  }

  return new ScriptedLanguageModel();
};

export const compose = (
  config: AppConfig,
  overrides: CompositionOverrides = {},
): Application => {
  // ── infrastructure ────────────────────────────────────────────────────────
  const clock = overrides.clock ?? systemClock;

  // In-process for now. Swapping to a durable transport is a change here and
  // nowhere else — no handler edits, no interface change.
  const events = new InProcessEventBus(clock, (error, context) => {
    // A handler failure is logged and contained. It must never reach the
    // publisher, because by the time events are emitted the turn has already
    // succeeded and the user is owed their answer.
    console.error('[nexa] event handler failed', {
      eventId: context.eventId,
      eventType: context.eventType,
      error: error instanceof Error ? error.message : String(error),
    });
  });

  const metrics = new RecordingMetrics();
  const observability: Observability =
    overrides.observability ?? { ...noopObservability, metrics };

  // ── capabilities ──────────────────────────────────────────────────────────
  // Registered explicitly rather than discovered. Once these become real
  // `CapabilityModule`s, `bootCapabilities` replaces this block and produces the
  // same `PortMap` — the shape below is already what it yields.
  const workingMemory = new InMemoryWorkingMemory();
  const memoryWrite = new RecordingMemoryWrite();

  const contextPorts: ContextPorts = {
    identity: new StaticIdentity(),
    personality: new InMemoryPersonality(),
    workingMemory,
    memoryRetrieval: new EmptyMemoryRetrieval(),
    goals: new NoGoals(),
    tools: new NoTools(),
    tokens: new HeuristicTokenEstimator(),
    // world, emotion, relationship, plan and decisionAdvisor are absent until
    // their engines exist. Absent is not degraded.
  };

  const languageModel = selectLanguageModel(config, overrides);

  // ── admission ─────────────────────────────────────────────────────────────
  // In-process, which is correct for one API process. Both become distributed
  // implementations behind the same interfaces when the backend outgrows that.
  const gate: TurnGate = new InProcessTurnGate();
  const idempotency: IdempotencyStore<TurnResult> = new InMemoryIdempotencyStore(clock);

  // ── core ──────────────────────────────────────────────────────────────────
  const turn = new CognitiveTurn({
    perception: new HeuristicPerception(),
    assembler: new ContextAssembler(contextPorts, clock),
    generator: new ActionGenerator({ model: languageModel }),
    workingMemory,
    memoryWrite,
    events,
    clock,
    gate,
    idempotency,
    observability,
  });

  return {
    turn,
    events,
    clock,
    metrics,
    modelName: languageModel.name,
    async shutdown(): Promise<void> {
      events.clear();
    },
  };
};
