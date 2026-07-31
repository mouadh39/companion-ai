import Anthropic from '@anthropic-ai/sdk';
import { type Result, type ToolId, ProviderError, err, ok, trustExternalId } from '@nexa/shared';
import type { JsonObject, Tool } from '@nexa/models';
import type {
  CompletionRequest,
  CompletionResult,
  LanguageModelPort,
  ModelCapabilities,
  ModelMessage,
  ModelToolCall,
  PortOptions,
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

  readonly capabilities: ModelCapabilities = {
    toolUse: true,
    streaming: true,
    contextWindow: 200_000,
    promptCaching: true,
  };

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
    options?: PortOptions,
  ): Promise<Result<CompletionResult, ProviderError>> {
    try {
      const response = await this.#client.beta.messages.create(
        {
          model: this.#model,
          max_tokens: request.maxTokens,
          system: request.system,
          messages: request.messages.map(toAnthropicMessage),
          ...(request.tools.length > 0 ? { tools: request.tools.map(toAnthropicTool) } : {}),
          output_config: { effort: this.#effort },
          // Claude Opus 5's safety classifiers can decline a request. Opting into
          // a server-side fallback means a declined turn is re-run on another
          // model inside the same call rather than surfacing as a dead end.
          betas: ['server-side-fallback-2026-06-01'],
          fallbacks: [{ model: 'claude-opus-4-8' }],
        },
        // Forwarded so a cancelled turn actually stops the request rather than
        // merely stopping the wait for it — the connection and the spend both
        // end here.
        options === undefined ? undefined : { signal: options.signal },
      );

      return ok(toCompletionResult(response));
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

/**
 * Maps one of our messages onto the provider's shape.
 *
 * Tool results go back as `tool_result` content blocks under a *user* message,
 * which is Anthropic's protocol — they are not prose the person said, and
 * flattening them into text is how a transcript ends up containing fabricated
 * user turns the model then treats as real.
 */
const toAnthropicMessage = (
  message: ModelMessage,
): Anthropic.Beta.BetaMessageParam => {
  switch (message.role) {
    case 'user':
      return { role: 'user', content: message.content };

    case 'assistant': {
      const blocks: Anthropic.Beta.BetaContentBlockParam[] = [];
      if (message.content.length > 0) {
        blocks.push({ type: 'text', text: message.content });
      }
      for (const call of message.toolCalls) {
        blocks.push({
          type: 'tool_use',
          id: call.callId,
          name: call.toolId,
          input: call.arguments,
        });
      }
      return { role: 'assistant', content: blocks };
    }

    case 'tool':
      return {
        role: 'user',
        content: message.results.map((result) => ({
          type: 'tool_result' as const,
          tool_use_id: result.callId,
          content: result.content,
          is_error: result.isError,
        })),
      };
  }
};

const toAnthropicTool = (tool: Tool): Anthropic.Beta.BetaToolUnion => ({
  name: tool.id,
  description: tool.description,
  input_schema: tool.parameters as Anthropic.Beta.BetaTool['input_schema'],
});

const toCompletionResult = (response: Anthropic.Beta.BetaMessage): CompletionResult => {
  // Checked before reading content: on a refusal `content` is empty or partial,
  // so indexing into it unconditionally would throw or return a truncated
  // answer presented as complete.
  const refused = response.stop_reason === 'refusal';

  const text = response.content
    .filter((block): block is Anthropic.Beta.BetaTextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('');

  const toolCalls: ModelToolCall[] = response.content
    .filter((block): block is Anthropic.Beta.BetaToolUseBlock => block.type === 'tool_use')
    .map((block) => ({
      callId: block.id,
      toolId: trustExternalId<ToolId>(block.name),
      arguments: (block.input ?? {}) as JsonObject,
    }));

  return {
    text,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    // The only observable signal that prompt caching is working. Without it a
    // prompt reordering that defeats the cache shows up as a bill, not a metric.
    cachedInputTokens: response.usage.cache_read_input_tokens ?? 0,
    model: response.model,
    refused,
    toolCalls,
  };
};
