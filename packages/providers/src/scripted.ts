import { type Result, type ProviderError, ok } from '@nexa/shared';
import type {
  CompletionRequest,
  CompletionResult,
  LanguageModelPort,
  ModelCapabilities,
  TokenEstimatorPort,
  TokenSink,
} from '@nexa/core';

/**
 * A provider that answers without a network call.
 *
 * Exists so the whole pipeline is runnable and testable with no API key and no
 * spend. That matters more than it sounds: every stage except generation can be
 * exercised end-to-end against this, which keeps the expensive dependency out
 * of the fast test loop and makes CI deterministic.
 *
 * It is not a mock of Claude. It makes no attempt to be clever, and nothing
 * about its output should be treated as representative.
 */
export class ScriptedLanguageModel implements LanguageModelPort {
  readonly name = 'scripted';

  /**
   * Declares no tool use, deliberately.
   *
   * A scripted model cannot decide to call anything, and claiming otherwise
   * would make the tool loop offer tools that are never exercised — the tests
   * would pass while covering nothing. Tool behaviour is tested against a fake
   * that returns real tool calls.
   */
  readonly capabilities: ModelCapabilities = {
    toolUse: false,
    streaming: true,
    contextWindow: 200_000,
    promptCaching: false,
  };

  readonly #responses: string[];
  #index = 0;

  constructor(responses: readonly string[] = []) {
    this.#responses = [...responses];
  }

  async complete(
    request: CompletionRequest,
  ): Promise<Result<CompletionResult, ProviderError>> {
    const scripted = this.#responses[this.#index];
    if (scripted !== undefined) this.#index++;

    const lastUserMessage = lastUserText(request);
    const text = scripted ?? `I heard you say: ${lastUserMessage}`;

    return ok({
      text,
      inputTokens: Math.ceil((request.system.length + lastUserMessage.length) / 4),
      outputTokens: Math.ceil(text.length / 4),
      cachedInputTokens: 0,
      model: 'scripted',
      refused: false,
      toolCalls: [],
    });
  }

  /**
   * Emits the whole answer as one chunk.
   *
   * Enough to exercise the streaming path end-to-end without pretending to
   * model token timing, which nothing downstream depends on.
   */
  async stream(
    request: CompletionRequest,
    sink: TokenSink,
  ): Promise<Result<CompletionResult, ProviderError>> {
    const result = await this.complete(request);
    if (result.ok) sink(result.value.text);
    return result;
  }

  reset(): void {
    this.#index = 0;
  }
}

/** The most recent thing the user actually said. */
const lastUserText = (request: CompletionRequest): string => {
  for (let i = request.messages.length - 1; i >= 0; i--) {
    const message = request.messages[i];
    if (message?.role === 'user') return message.content;
  }
  return '';
};

/**
 * Character-count token estimation.
 *
 * A stand-in, and labelled as one. Roughly four characters per token holds for
 * English prose and degrades badly on code, JSON and non-Latin scripts — it
 * under-counts exactly where the budget matters most.
 *
 * The honest implementation calls the provider's own `count_tokens`. This
 * exists so the budget is enforced from day one rather than added later, and it
 * is a port precisely so replacing it touches nothing else.
 */
export class HeuristicTokenEstimator implements TokenEstimatorPort {
  estimate(text: string): number {
    return Math.ceil(text.length / 4);
  }
}
