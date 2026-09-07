import { newActionId } from '@nexa/shared';
import type { CompanionId } from '@nexa/shared';
import type {
  CognitiveContext,
  Decision,
  DiagnosticCode,
  DiagnosticSeverity,
  ModelCall,
  Tool,
} from '@nexa/models';
import { importance, isEmbodiedAction } from '@nexa/models';
import type { Action, SpeakAction } from '@nexa/actions';
import { readActionBlock } from './action-block.js';
import type { PortOptions } from '../execution/index.js';
import { callPort } from '../execution/index.js';
import type {
  CompletionResult,
  LanguageModelPort,
  ModelMessage,
  ModelToolCall,
  ToolExecutionPort,
  ToolOutcome,
} from '../ports.js';

/**
 * A diagnostic raised during generation.
 *
 * Returned rather than written straight to the turn record, so the generator
 * has no dependency on the builder and can be tested on its own. The turn folds
 * these in.
 */
export interface GenerationDiagnostic {
  readonly code: DiagnosticCode;
  readonly severity: DiagnosticSeverity;
  readonly detail: string;
}

/**
 * Everything one generation produced, successful or not.
 *
 * Not a `Result`, and deliberately so: the measurements matter *most* when
 * generation failed. A failure that discarded its model calls would hide both
 * the cost already incurred and how far the loop got.
 */
export interface GenerationOutcome {
  readonly actions: readonly Action[];
  readonly modelCalls: readonly ModelCall[];
  readonly diagnostics: readonly GenerationDiagnostic[];
  readonly toolCallCount: number;
  /** Null when generation succeeded. */
  readonly failure: Error | null;
}

export interface ToolLoopLimits {
  /**
   * How many times the model may ask for tools before the loop stops.
   *
   * Three independent limits guard this loop — iterations, wall clock, and
   * cumulative tokens — because each fails differently and any one alone leaves
   * a hole. Iterations alone permits four very slow calls; a deadline alone
   * permits a hundred fast ones; tokens alone permits an unbounded number of
   * cheap ones.
   */
  readonly maxIterations: number;
  /** Cumulative tokens across every call in one turn. */
  readonly maxTotalTokens: number;
  /** Ceiling for a single provider call. */
  readonly maxOutputTokens: number;
  /**
   * Ceiling for a single provider call when the client speaks the answer aloud.
   *
   * Lower than {@link maxOutputTokens} because the two media have different
   * costs. Tokens a reader skips in a second are tokens a listener must sit
   * through in real time, and the ceiling that merely bounds a bill for a chat
   * client bounds a *monologue* for a voice one: 1024 tokens is roughly five
   * minutes of speech, which no conversation survives.
   *
   * Applied as a floor against {@link maxOutputTokens}, never as an override —
   * an operator who lowered the global ceiling meant it, and a voice turn must
   * not quietly raise it back up.
   *
   * ## Why this is not as small as the spoken length suggests
   *
   * On a reasoning model this budget is not the answer's length — it is the
   * answer *plus* the thinking that produced it. `openai/gpt-oss-120b` bills
   * reasoning tokens against `max_completion_tokens`, and a two-sentence reply
   * measured here costs 100–171 completion tokens with 94–420 characters of
   * reasoning behind it. When reasoning consumes the whole budget before any
   * prose is emitted, the provider returns `finish_reason: length` with empty
   * content, and the turn fails outright — the user hears nothing at all.
   *
   * That was observed at 384: roughly one spoken turn in five died this way.
   * The ceiling that actually governs spoken length is the prompt instruction,
   * not this number, so the right size here is "comfortably above what the
   * model needs to think", not "the length we want back".
   */
  readonly voiceMaxOutputTokens: number;
  /** Ceiling for a single tool invocation. */
  readonly toolTimeoutMs: number;
}

export const defaultToolLoopLimits: ToolLoopLimits = {
  maxIterations: 4,
  maxTotalTokens: 32_000,
  maxOutputTokens: 1_024,
  // Headroom for reasoning plus a short spoken answer, and still well under the
  // 1024 a text client gets. Spoken brevity is enforced by the prompt, which
  // holds replies to a few hundred characters regardless of what this permits.
  voiceMaxOutputTokens: 640,
  toolTimeoutMs: 5_000,
};

export interface ToolLoopDependencies {
  readonly model: LanguageModelPort;
  readonly tools?: ToolExecutionPort;
  readonly limits: ToolLoopLimits;
}

export interface ToolLoopRequest {
  readonly companionId: CompanionId;
  readonly context: CognitiveContext;
  readonly decision: Decision;
  readonly system: string;
  readonly messages: readonly ModelMessage[];
  readonly availableTools: readonly Tool[];
  readonly onToken: ((chunk: string) => void) | null;
}

/**
 * Generates a response, invoking tools until the model is done or a limit stops it.
 *
 * The single-shot generator this replaces could not use a tool at all. Adding
 * the loop is what makes `call_tool` real, and bounding it three ways is what
 * keeps a runaway model from turning one message into an unbounded bill on a
 * path a user is waiting on.
 */
export const runToolLoop = async (
  dependencies: ToolLoopDependencies,
  request: ToolLoopRequest,
  options: PortOptions,
): Promise<GenerationOutcome> => {
  const { model, limits } = dependencies;
  const modelCalls: ModelCall[] = [];
  const diagnostics: GenerationDiagnostic[] = [];
  const messages: ModelMessage[] = [...request.messages];

  const diagnose = (
    code: DiagnosticCode,
    severity: DiagnosticSeverity,
    detail: string,
  ): void => {
    diagnostics.push({ code, severity, detail });
  };

  const done = (
    actions: readonly Action[],
    failure: Error | null,
    toolCallCount: number,
  ): GenerationOutcome => ({
    actions,
    modelCalls,
    diagnostics,
    toolCallCount,
    failure,
  });

  // Tools are offered only when *both* halves are present. Offering them to a
  // model that cannot call them wastes prompt budget on every turn; offering
  // them with no executor produces calls nothing can satisfy.
  const canUseTools =
    model.capabilities.toolUse &&
    dependencies.tools !== undefined &&
    request.availableTools.length > 0;

  if (
    request.availableTools.length > 0 &&
    !model.capabilities.toolUse &&
    dependencies.tools !== undefined
  ) {
    diagnose(
      'model_capability_missing',
      'warning',
      `${model.name} does not support tool use; ${String(request.availableTools.length)} tools were withheld.`,
    );
  }

  const offered = canUseTools ? request.availableTools : [];
  let spentTokens = 0;
  let toolCallCount = 0;

  for (let iteration = 0; ; iteration++) {
    if (options.deadline.hasExpired()) {
      diagnose('deadline_exhausted', 'error', 'No budget left to call the model.');
      return done([], new Error('The turn ran out of time before generating a response.'), toolCallCount);
    }

    const call = await callPort(
      'language_model',
      options.deadline.remainingMs(),
      options,
      (scoped) =>
        invoke(model, {
          system: request.system,
          messages,
          maxTokens: limits.maxOutputTokens,
          tools: offered,
        }, request.onToken, scoped),
    );

    if (call.outcome !== 'ok') {
      const reason =
        call.outcome === 'error'
          ? call.error
          : new Error(`The model did not respond (${call.outcome}).`);
      return done([], reason, toolCallCount);
    }

    const result = call.value;
    if (!result.ok) {
      return done([], result.error, toolCallCount);
    }

    const completion = result.value;
    modelCalls.push({
      model: completion.model,
      inputTokens: completion.inputTokens,
      outputTokens: completion.outputTokens,
      cachedInputTokens: completion.cachedInputTokens,
      latencyMs: call.durationMs,
      refused: completion.refused,
    });
    spentTokens += completion.inputTokens + completion.outputTokens;

    if (completion.refused) {
      diagnose('provider_refused', 'error', 'The provider declined the request.');
      return done(
        [],
        new Error('The model provider declined to answer this request.'),
        toolCallCount,
      );
    }

    // No tool calls means the model considers itself finished.
    if (completion.toolCalls.length === 0) {
      return finish(completion, request, done, toolCallCount, diagnose);
    }

    // Every limit below stops the loop *and answers with what is in hand*
    // rather than failing. The model has already produced prose alongside its
    // tool request in most cases, and a partial answer beats none.
    if (iteration + 1 >= limits.maxIterations) {
      diagnose(
        'tool_loop_exhausted',
        'warning',
        `Stopped after ${String(limits.maxIterations)} tool rounds with work outstanding.`,
      );
      return finish(completion, request, done, toolCallCount, diagnose);
    }

    if (spentTokens >= limits.maxTotalTokens) {
      diagnose(
        'tool_loop_exhausted',
        'warning',
        `Stopped after ${String(spentTokens)} tokens, over the ${String(limits.maxTotalTokens)} ceiling.`,
      );
      return finish(completion, request, done, toolCallCount, diagnose);
    }

    if (options.deadline.remainingMs() <= limits.toolTimeoutMs) {
      diagnose(
        'tool_loop_deadline',
        'warning',
        'Stopped before invoking tools: not enough time left to use the results.',
      );
      return finish(completion, request, done, toolCallCount, diagnose);
    }

    const executor = dependencies.tools;
    if (executor === undefined) {
      // Unreachable while `canUseTools` gates the offer, but a model can return
      // a tool call it was never offered, and a crash here would cost the turn.
      diagnose('model_capability_missing', 'error', 'The model requested a tool with no executor configured.');
      return finish(completion, request, done, toolCallCount, diagnose);
    }

    // Independent calls, so they run together. A model asking for three
    // lookups should pay for the slowest, not the sum.
    const outcomes = await Promise.all(
      completion.toolCalls.map((toolCall) =>
        execute(executor, request.companionId, toolCall, limits.toolTimeoutMs, options),
      ),
    );
    toolCallCount += outcomes.length;

    messages.push({
      role: 'assistant',
      content: completion.text,
      toolCalls: completion.toolCalls,
    });
    messages.push({ role: 'tool', results: outcomes });
  }
};

/** Calls the provider, streaming when both sides support it. */
const invoke = async (
  model: LanguageModelPort,
  request: Parameters<LanguageModelPort['complete']>[0],
  onToken: ((chunk: string) => void) | null,
  options: PortOptions,
): ReturnType<LanguageModelPort['complete']> => {
  if (onToken !== null && model.capabilities.streaming && model.stream !== undefined) {
    return model.stream(request, onToken, options);
  }
  return model.complete(request, options);
};

/**
 * Runs one tool, turning any failure into something the model can read.
 *
 * A failed tool is reported back rather than ending the turn, because the
 * companion can act on it — "your calendar is unreachable right now" is a
 * better outcome than silence, and only the model can phrase that.
 */
const execute = async (
  executor: ToolExecutionPort,
  companionId: CompanionId,
  toolCall: ModelToolCall,
  timeoutMs: number,
  options: PortOptions,
): Promise<ToolOutcome> => {
  const call = await callPort(`tool:${toolCall.toolId}`, timeoutMs, options, (scoped) =>
    executor.execute(
      {
        companionId,
        callId: toolCall.callId,
        toolId: toolCall.toolId,
        arguments: toolCall.arguments,
      },
      scoped,
    ),
  );

  if (call.outcome !== 'ok') {
    return {
      callId: toolCall.callId,
      content: `The tool did not complete (${call.outcome}).`,
      isError: true,
    };
  }

  if (!call.value.ok) {
    return {
      callId: toolCall.callId,
      content: `The tool failed: ${call.value.error.message}`,
      isError: true,
    };
  }

  return call.value.value;
};

/** Turns a finished completion into actions. */
const finish = (
  completion: CompletionResult,
  request: ToolLoopRequest,
  done: (
    actions: readonly Action[],
    failure: Error | null,
    toolCallCount: number,
  ) => GenerationOutcome,
  toolCallCount: number,
  diagnose: (code: DiagnosticCode, severity: DiagnosticSeverity, detail: string) => void,
): GenerationOutcome => {
  // The client's declaration is the gate, exactly as it is for whether the
  // model was told a body exists at all. A client that declared nothing is
  // never offered the block, so an unembodied session cannot produce body
  // actions even if the model invents the syntax.
  const declared = request.context.clientCapabilities?.actions ?? [];
  const embodied = declared.filter(isEmbodiedAction);

  const block = readActionBlock(completion.text, request.decision.id, embodied);
  for (const diagnostic of block.diagnostics) {
    diagnose(diagnostic.code, diagnostic.severity, diagnostic.detail);
  }

  const text = block.prose;

  // An empty completion is a failure; a completion that was *only* a block is
  // not. The second is a companion that acted without narrating, which is a
  // legitimate answer to "stop" — and failing the turn would throw away an
  // action the body is entitled to perform.
  if (text.length === 0 && block.actions.length === 0) {
    return done([], new Error('The model returned an empty response.'), toolCallCount);
  }

  const actions: Action[] = [...block.actions];

  if (text.length > 0) {
    actions.push({
      id: newActionId(),
      type: 'speak',
      decisionId: request.decision.id,
      text,
      tone: toneFor(request.context, request.decision),
    });
  }

  // The decision to remember is surfaced as its own action so it appears in the
  // action stream and the audit trail. The write itself is asynchronous.
  if (request.decision.kind === 'remember') {
    actions.push({
      id: newActionId(),
      type: 'remember',
      decisionId: request.decision.id,
      content: request.context.perception.text,
      importance: importance(0.7),
    });
  }

  return done(actions, null, toolCallCount);
};

/**
 * Chooses a delivery tone.
 *
 * Defers to the composed `ExpressionProfile` when one is present. That profile
 * resolved tone from personality, relationship and the moment together, and
 * recorded why — re-deriving it here from two of those inputs would be a second
 * answer to a question already settled, and the two would drift.
 *
 * The heuristic below remains as the fallback for a deployment with no
 * expression capability composed in. It is deliberately the narrower rule: it
 * sees perception and warmth, and nothing else.
 */
export const toneFor = (
  context: CognitiveContext,
  decision: Decision,
): SpeakAction['tone'] => {
  if (context.expression !== null) return context.expression.tone;

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
