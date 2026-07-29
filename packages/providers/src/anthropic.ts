import Anthropic from '@anthropic-ai/sdk';
import { type Result, ProviderError, err, ok } from '@nexa/shared';
import type {
  CompletionRequest,
  CompletionResult,
  LanguageModelPort,
} from '@nexa/core';

/**
 * Anthropic implementation of {@link LanguageModelPort}.
 *
 * Everything Anthropic-specific is confined to this file. The companion's
 * identity, memory, goals and personality live outside it, so replacing this
 * adapter changes which model writes the words and nothing about who is
 * speaking — which is ADR-002 made structural rather than aspirational.
 */

export interface AnthropicProviderOptions {
  readonly apiKey: string;
  /** Defaults to Claude Opus 5. */
  readonly model?: string;
  /**
   * Thinking depth and overall token spend.
   *
   * `low` by default. A conversational turn is latency-sensitive, and on this
   * model the lower effort levels are unusually strong — effort is the primary
   * cost and latency lever, more effective than disabling thinking outright.
   */
  readonly effort?: 'low' | 'medium' | 'high';
  readonly timeoutMs?: number;
}

const DEFAULT_MODEL = 'claude-opus-5';

/** Retried by the caller; anything else is terminal for this turn. */
const isRetryable = (error: unknown): boolean =>
  error instanceof Anthropic.RateLimitError ||
  error instanceof Anthropic.InternalServerError ||
  error instanceof Anthropic.APIConnectionError;

export class AnthropicLanguageModel implements LanguageModelPort {
  readonly name: string;

  readonly #client: Anthropic;
  readonly #model: string;
  readonly #effort: 'low' | 'medium' | 'high';

  constructor(options: AnthropicProviderOptions) {
    this.#client = new Anthropic({
      apiKey: options.apiKey,
      ...(options.timeoutMs !== undefined ? { timeout: options.timeoutMs } : {}),
    });
    this.#model = options.model ?? DEFAULT_MODEL;
    this.#effort = options.effort ?? 'low';
    this.name = `anthropic:${this.#model}`;
  }

  async complete(
    request: CompletionRequest,
  ): Promise<Result<CompletionResult, ProviderError>> {
    try {
      const response = await this.#client.beta.messages.create({
        model: this.#model,
        max_tokens: request.maxTokens,
        system: request.system,
        messages: request.messages.map((message) => ({
          role: message.role,
          content: message.content,
        })),
        output_config: { effort: this.#effort },
        // Claude Opus 5's safety classifiers can decline a request. Opting into
        // a server-side fallback means a declined turn is re-run on another
        // model inside the same call rather than surfacing as a dead end.
        betas: ['server-side-fallback-2026-06-01'],
        fallbacks: [{ model: 'claude-opus-4-8' }],
      });

      // Checked before reading content: on a refusal `content` is empty or
      // partial, so indexing into it unconditionally would throw or return a
      // truncated answer presented as complete.
      const refused = response.stop_reason === 'refusal';

      const text = response.content
        .filter(
          (block): block is Extract<typeof block, { type: 'text' }> =>
            block.type === 'text',
        )
        .map((block) => block.text)
        .join('');

      return ok({
        text,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        model: response.model,
        refused,
      });
    } catch (error) {
      return err(
        new ProviderError(
          error instanceof Error ? error.message : 'Unknown provider failure.',
          { provider: this.name, retryable: isRetryable(error), cause: error },
        ),
      );
    }
  }
}
