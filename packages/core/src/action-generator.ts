import { type Result, err, newActionId, ok } from '@nexa/shared';
import type { CognitiveContext, Decision } from '@nexa/models';
import { isDegraded } from '@nexa/models';
import type { Action, SpeakAction } from '@nexa/actions';
import type { LanguageModelPort, ModelMessage } from './ports.js';

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
    parts.push(`Active goals you are helping with:\n${context.goals.map((g) => `- ${g}`).join('\n')}`);
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
    parts.push(`Tools available to you: ${context.availableTools.join(', ')}.`);
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
  const history: ModelMessage[] = context.workingMemory.map((turn) => ({
    role: turn.role === 'user' ? ('user' as const) : ('assistant' as const),
    content: turn.content,
  }));

  history.push({ role: 'user', content: context.perception.text });
  return history;
};

/** Chooses a delivery tone from the decision and the user's estimated state. */
const toneFor = (context: CognitiveContext, decision: Decision): SpeakAction['tone'] => {
  const emotion = context.perception.emotion;

  // A low-confidence emotional read is not acted on. Treating a weak signal as
  // fact is how an assistant tells a cheerful person they seem upset.
  if (emotion !== null && emotion.confidence >= 0.6) {
    if (emotion.emotion === 'frustrated' || emotion.emotion === 'stressed') return 'concerned';
    if (emotion.emotion === 'sad') return 'concerned';
    if (emotion.emotion === 'proud' || emotion.emotion === 'happy') return 'encouraging';
    if (emotion.emotion === 'excited') return 'playful';
  }

  if (decision.kind === 'ask_clarifying_question') return 'neutral';
  return context.personality.traits.warmth >= 0.7 ? 'warm' : 'neutral';
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

export class ActionGenerator {
  readonly #model: LanguageModelPort;
  readonly #maxTokens: number;

  constructor(model: LanguageModelPort, maxTokens = 1_024) {
    this.#model = model;
    this.#maxTokens = maxTokens;
  }

  async generate(
    context: CognitiveContext,
    decision: Decision,
  ): Promise<Result<readonly Action[], Error>> {
    // Silence needs no provider call. Spending a round trip to generate text
    // that is then discarded would be the wrong shape entirely.
    if (decision.kind === 'stay_silent') {
      return ok([]);
    }

    const instruction = decisionInstruction(decision);
    const system = instruction === null
      ? buildSystemPrompt(context)
      : `${buildSystemPrompt(context)}\n\n${instruction}`;

    const result = await this.#model.complete({
      system,
      messages: buildMessages(context),
      maxTokens: this.#maxTokens,
    });

    if (!result.ok) {
      return err(result.error);
    }

    if (result.value.refused) {
      return err(new Error('The model provider declined to answer this request.'));
    }

    const text = result.value.text.trim();
    if (text.length === 0) {
      return err(new Error('The model returned an empty response.'));
    }

    const actions: Action[] = [
      {
        id: newActionId(),
        type: 'speak',
        decisionId: decision.id,
        text,
        tone: toneFor(context, decision),
      },
    ];

    // The decision to remember is surfaced as its own action so it appears in
    // the action stream and the audit trail. The write itself is asynchronous.
    if (decision.kind === 'remember') {
      actions.push({
        id: newActionId(),
        type: 'remember',
        decisionId: decision.id,
        content: context.perception.text,
        importance: 0.7,
      });
    }

    return ok(actions);
  }
}
