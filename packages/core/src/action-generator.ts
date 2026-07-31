import type { CognitiveContext, Decision } from '@nexa/models';
import { isDegraded } from '@nexa/models';
import type { PortOptions } from './execution/index.js';
import type { GenerationOutcome, ToolLoopLimits } from './generation/index.js';
import { defaultToolLoopLimits, deliver, runToolLoop } from './generation/index.js';
import type { TurnSink } from './generation/index.js';
import type { LanguageModelPort, ModelMessage, ToolExecutionPort } from './ports.js';

/**
 * Turns a decision into concrete actions.
 *
 * This is the only stage that produces language, and the only one that calls a
 * model provider. Everything upstream reasons in structured terms; everything
 * downstream ships actions to a client.
 */

/**
 * Builds the system prompt from the assembled context.
 *
 * Never one giant static prompt. Each section is contributed by the part of the
 * system that owns it, in a fixed order — identity first, volatile context last
 * — because prompt caching is a prefix match: the stable prefix must physically
 * precede anything that changes per turn, or nothing caches.
 *
 * Sections that were dropped during assembly are simply absent, and the
 * companion is told when that happened rather than left to fill the gap.
 */
export const buildSystemPrompt = (context: CognitiveContext): string => {
  const parts: string[] = [];

  parts.push(
    [
      `You are ${context.identity.name}.`,
      context.identity.selfDescription,
      `Your core values: ${context.identity.coreValues.join(', ')}.`,
    ].join('\n'),
  );

  const traits = Object.entries(context.personality.traits)
    .map(([name, value]) => `${name} ${value.toFixed(2)}`)
    .join(', ');
  parts.push(
    [
      'Your personality, as normalised traits from 0 to 1:',
      traits,
      'These shape how you communicate. They never change what is true, and they never override a safety consideration.',
    ].join('\n'),
  );

  if (context.goals.length > 0) {
    parts.push(
      `Active goals you are helping with:\n${context.goals
        .map((goal) => `- ${goal.description}`)
        .join('\n')}`,
    );
  }

  if (context.retrievedMemories.length > 0) {
    const lines = context.retrievedMemories.map(
      (retrieved) =>
        `- [${retrieved.memory.type}, relevance ${retrieved.score.toFixed(2)}] ${retrieved.memory.content}`,
    );
    parts.push(
      [
        'Relevant things you remember about this person. Draw on them naturally; do not recite them:',
        ...lines,
      ].join('\n'),
    );
  }

  if (context.availableTools.length > 0) {
    parts.push(
      `Tools available to you: ${context.availableTools.map((tool) => tool.name).join(', ')}.`,
    );
  }

  // Told, not hidden. A companion that knows its context is incomplete can say
  // so; one that does not will confabulate over the gap.
  if (isDegraded(context.budget)) {
    const dropped = context.budget.omissions
      .filter((omission) => omission.reason !== 'empty')
      .map((omission) => omission.section);
    if (dropped.length > 0) {
      parts.push(
        `Some context was unavailable this turn (${dropped.join(', ')}). If it would have mattered, say so plainly rather than guessing.`,
      );
    }
  }

  parts.push(
    [
      'Respond as yourself, in plain prose. Do not narrate your reasoning or describe what you are about to do.',
      'Keep responses focused and brief. Lead with the substance.',
    ].join('\n'),
  );

  return parts.join('\n\n');
};

/** Maps working memory to provider messages, oldest first. */
export const buildMessages = (context: CognitiveContext): readonly ModelMessage[] => {
  const history: ModelMessage[] = context.workingMemory.map((turn) =>
    turn.role === 'user'
      ? { role: 'user', content: turn.content }
      : // Replayed history carries no tool calls: working memory is the compact
        // projection of what was *said*, not a transcript of how it was reached.
        { role: 'assistant', content: turn.content, toolCalls: [] },
  );

  history.push({ role: 'user', content: context.perception.text });
  return history;
};

/** Instruction appended for decisions whose realisation needs steering. */
const decisionInstruction = (decision: Decision): string | null => {
  switch (decision.kind) {
    case 'ask_clarifying_question':
      return 'You do not have enough to answer well. Ask one specific clarifying question, and nothing else.';
    case 'acknowledge':
      return 'Acknowledge briefly and naturally. Do not expand into an answer that was not asked for.';
    case 'remember':
      return 'Confirm briefly that you have understood and will remember this.';
    case 'answer':
    case 'call_tool':
    case 'defer':
    case 'stay_silent':
      return null;
  }
};

export interface ActionGeneratorDependencies {
  readonly model: LanguageModelPort;
  /** Absent means tools are never offered, whatever the registry lists. */
  readonly toolExecution?: ToolExecutionPort;
  readonly limits?: ToolLoopLimits;
}

export class ActionGenerator {
  readonly #model: LanguageModelPort;
  readonly #toolExecution: ToolExecutionPort | undefined;
  readonly #limits: ToolLoopLimits;

  constructor(dependencies: ActionGeneratorDependencies | LanguageModelPort) {
    // A bare port is still accepted because most call sites have nothing to say
    // about tools or limits, and forcing them to wrap it in an object would be
    // ceremony with no information in it.
    const resolved: ActionGeneratorDependencies =
      'complete' in dependencies ? { model: dependencies } : dependencies;

    this.#model = resolved.model;
    this.#toolExecution = resolved.toolExecution;
    this.#limits = resolved.limits ?? defaultToolLoopLimits;
  }

  async generate(
    context: CognitiveContext,
    decision: Decision,
    options: PortOptions,
    sink?: TurnSink,
  ): Promise<GenerationOutcome> {
    // Silence needs no provider call. Spending a round trip to generate text
    // that is then discarded would be the wrong shape entirely.
    if (decision.kind === 'stay_silent') {
      return {
        actions: [],
        modelCalls: [],
        diagnostics: [],
        toolCallCount: 0,
        failure: null,
      };
    }

    const instruction = decisionInstruction(decision);
    const system =
      instruction === null
        ? buildSystemPrompt(context)
        : `${buildSystemPrompt(context)}\n\n${instruction}`;

    // Wrapped rather than passed through, so a caller's throwing callback
    // cannot fail a turn that has already produced a good answer.
    const onToken =
      sink?.onToken === undefined
        ? null
        : (chunk: string): void => {
            deliver(sink, (target) => target.onToken?.(chunk));
          };

    return runToolLoop(
      {
        model: this.#model,
        ...(this.#toolExecution !== undefined ? { tools: this.#toolExecution } : {}),
        limits: this.#limits,
      },
      {
        companionId: context.companionId,
        context,
        decision,
        system,
        messages: buildMessages(context),
        // Tool selection is the model's, not Core's. Pre-selecting here and
        // then asking the model would be two reasoning systems disagreeing at
        // the cost of a round trip.
        availableTools: context.availableTools,
        onToken,
      },
      options,
    );
  }
}
