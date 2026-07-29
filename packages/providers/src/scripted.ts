import { type Result, type ProviderError, ok } from '@nexa/shared';
import type {
  CompletionRequest,
  CompletionResult,
  LanguageModelPort,
  TokenEstimatorPort,
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

    const lastUserMessage =
      [...request.messages].reverse().find((message) => message.role === 'user')?.content ??
      '';

    const text = scripted ?? `I heard you say: ${lastUserMessage}`;

    return ok({
      text,
      inputTokens: Math.ceil((request.system.length + lastUserMessage.length) / 4),
      outputTokens: Math.ceil(text.length / 4),
      model: 'scripted',
      refused: false,
    });
  }

  reset(): void {
    this.#index = 0;
  }
}

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
