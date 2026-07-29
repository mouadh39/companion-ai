import { systemClock, type Clock } from '@nexa/shared';
import { InProcessEventBus, type EventBus } from '@nexa/events';
import {
  ActionGenerator,
  CognitiveTurn,
  ContextAssembler,
  type ContextPorts,
  type LanguageModelPort,
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
 */

export interface Application {
  readonly turn: CognitiveTurn;
  readonly events: EventBus;
  readonly clock: Clock;
  readonly modelName: string;
  shutdown(): Promise<void>;
}

export interface CompositionOverrides {
  readonly clock?: Clock;
  readonly languageModel?: LanguageModelPort;
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
  const clock = overrides.clock ?? systemClock;

  // A handler failure is logged and contained. It must never reach the
  // publisher, because by the time events are emitted the turn has already
  // succeeded and the user is owed their answer.
  const events = new InProcessEventBus(clock, (error, context) => {
    console.error('[nexa] event handler failed', {
      eventId: context.eventId,
      eventType: context.eventType,
      error: error instanceof Error ? error.message : String(error),
    });
  });

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
  };

  const languageModel = selectLanguageModel(config, overrides);

  const turn = new CognitiveTurn({
    perception: new HeuristicPerception(),
    assembler: new ContextAssembler(contextPorts, clock),
    generator: new ActionGenerator(languageModel),
    workingMemory,
    memoryWrite,
    events,
    clock,
  });

  return {
    turn,
    events,
    clock,
    modelName: languageModel.name,
    async shutdown(): Promise<void> {
      events.clear();
    },
  };
};
