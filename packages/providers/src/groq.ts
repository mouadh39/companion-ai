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
 * Groq implementation of {@link LanguageModelPort}.
 *
 * Everything Groq-specific is confined to this file, exactly as it is for
 * Anthropic. The companion's identity, memory, goals and personality live
 * outside it, so switching to Groq changes which model writes the words and
 * nothing about who is speaking — ADR-002 made structural rather than
 * aspirational.
 *
 * ## Why `fetch` and not an SDK
 *
 * Groq speaks the OpenAI chat-completions protocol, and the part of it this
 * adapter needs is small, flat and stable. A vendor SDK would add a dependency,
 * a second retry policy layered under Core's deadline, and its own error
 * taxonomy to translate — for a request this file can express in one object.
 * The Anthropic adapter uses an SDK because its beta features (server-side
 * fallback, effort control, prompt caching accounting) are genuinely worth the
 * coupling; nothing here is.
 */

export interface GroqProviderOptions {
  readonly apiKey: string;
  /**
   * Defaults to `llama-3.3-70b-versatile`.
   *
   * Hosted model catalogues move faster than releases do. When a model is
   * retired the API answers 404, and this adapter says so by name rather than
   * failing generically — see {@link GroqLanguageModel.complete}.
   */
  readonly model?: string;
  /** Overridden only by tests and by OpenAI-compatible gateways. */
  readonly baseUrl?: string;
  /**
   * Ceiling on one request, in milliseconds.
   *
   * A backstop, not the primary limit. Core already scopes every port call to
   * what remains of the turn's budget and passes the signal down, so this only
   * binds when a caller supplies a deadline more generous than one exchange
   * should ever take.
   */
  readonly timeoutMs?: number;
  /** Governs the assembler's token ceiling. Model-dependent, hence an option. */
  readonly contextWindow?: number;
  /** Left to the provider's default when unset. */
  readonly temperature?: number;
  /** Injected by tests. Production uses the platform `fetch`. */
  readonly fetchImpl?: FetchLike;
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

const DEFAULT_BASE_URL = 'https://api.groq.com/openai/v1';
const DEFAULT_MODEL = 'llama-3.3-70b-versatile';
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_CONTEXT_WINDOW = 128_000;

/**
 * Statuses worth trying again.
 *
 * Everything else is terminal for this turn: a bad key, an unknown model or a
 * malformed request will fail identically on a second attempt, and retrying
 * them spends the user's latency budget to reach the same answer.
 */
const RETRYABLE_STATUSES = new Set([408, 409, 429, 500, 502, 503, 504]);

export class GroqLanguageModel implements LanguageModelPort {
  readonly name: string;

  /**
   * `streaming` is false because this adapter does not implement `stream`.
   *
   * Groq does stream, and claiming the capability without the method would be
   * harmless only by accident — Core checks both. Declaring it honestly means
   * generation falls back to `complete` and the incremental delivery path stays
   * visibly unimplemented rather than silently broken.
   *
   * `promptCaching` is false for the same reason: these models bill no cached
   * prefix, so reporting otherwise would put a permanent zero into the one
   * metric that shows caching working.
   */
  readonly capabilities: ModelCapabilities;

  readonly #apiKey: string;
  readonly #model: string;
  readonly #baseUrl: string;
  readonly #endpoint: string;
  readonly #timeoutMs: number;
  readonly #temperature: number | undefined;
  readonly #fetch: FetchLike;

  constructor(options: GroqProviderOptions) {
    this.#apiKey = options.apiKey;
    this.#model = options.model ?? DEFAULT_MODEL;
    this.#baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/u, '');
    this.#endpoint = `${this.#baseUrl}/chat/completions`;
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#temperature = options.temperature;
    this.#fetch = options.fetchImpl ?? globalThis.fetch;

    this.name = `groq:${this.#model}`;
    this.capabilities = {
      toolUse: true,
      streaming: false,
      contextWindow: options.contextWindow ?? DEFAULT_CONTEXT_WINDOW,
      promptCaching: false,
    };
  }

  async complete(
    request: CompletionRequest,
    options?: PortOptions,
  ): Promise<Result<CompletionResult, ProviderError>> {
    const parent = options?.signal;

    // Read through a call rather than as a property, so the compiler does not
    // narrow it: the whole point is that this answer changes mid-request.
    const cancelledByCaller = (): boolean => parent !== undefined && parent.aborted;

    // Checked before the connection is opened. Spending a request on work whose
    // result is already unwanted is pure waste, and Core makes the same check
    // one level up for the same reason.
    if (cancelledByCaller()) {
      return err(this.#failure('The turn was cancelled before the request was sent.', false));
    }

    // Two independent reasons to stop — our own ceiling and the turn's deadline —
    // are merged into one controller rather than raced. Racing a timer stops the
    // *waiting* but not the work: the connection stays held and the quota stays
    // spent.
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.#timeoutMs);
    const onParentAbort = (): void => {
      controller.abort();
    };
    parent?.addEventListener('abort', onParentAbort, { once: true });

    try {
      const response = await this.#fetch(this.#endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.#apiKey}`,
        },
        body: JSON.stringify(this.#body(request)),
        signal: controller.signal,
      });

      if (!response.ok) {
        return err(await this.#httpFailure(response));
      }

      let payload: unknown;
      try {
        payload = await response.json();
      } catch (error) {
        return err(this.#failure('Groq answered 200 with a body that is not JSON.', true, error));
      }

      return this.#read(payload as GroqCompletion);
    } catch (error) {
      // Order matters: an abort surfaces the same way whichever side caused it,
      // and a timeout is retryable while a cancelled turn is emphatically not.
      if (timedOut) {
        return err(
          this.#failure(`Groq did not answer within ${String(this.#timeoutMs)} ms.`, true, error),
        );
      }
      if (cancelledByCaller()) {
        return err(this.#failure('The turn was cancelled while waiting for Groq.', false, error));
      }

      // Anything left is transport: DNS, TLS, a dropped connection. All worth
      // another attempt, none of them the caller's fault.
      return err(
        this.#failure(
          `Could not reach Groq at ${this.#endpoint}: ${describe(error)}`,
          true,
          error,
        ),
      );
    } finally {
      clearTimeout(timer);
      parent?.removeEventListener('abort', onParentAbort);
    }
  }

  #body(request: CompletionRequest): GroqRequestBody {
    return {
      model: this.#model,
      // The system prompt leads, which is both the protocol's shape and the
      // ordering prompt caching needs: a stable prefix before anything volatile.
      messages: [{ role: 'system', content: request.system }, ...toGroqMessages(request.messages)],
      max_completion_tokens: request.maxTokens,
      ...(this.#temperature !== undefined ? { temperature: this.#temperature } : {}),
      ...(request.tools.length > 0 ? { tools: request.tools.map(toGroqTool) } : {}),
    };
  }

  async #httpFailure(response: Response): Promise<ProviderError> {
    const raw = await response.text().catch(() => '');
    let detail = raw.trim();

    try {
      const parsed = JSON.parse(raw) as GroqErrorBody;
      const message = parsed.error?.message;
      if (typeof message === 'string' && message.length > 0) detail = message;
    } catch {
      // Not JSON. The raw text is already the best detail available.
    }

    const parts = [`Groq returned ${String(response.status)}`];
    if (detail.length > 0) parts.push(detail);

    // Operator guidance attached to the two failures that are almost always a
    // misconfiguration rather than an outage. A message that only says "401" is
    // a message that costs somebody an hour.
    if (response.status === 401 || response.status === 403) {
      parts.push('Check GROQ_API_KEY.');
    } else if (response.status === 404) {
      parts.push(
        `Check NEXA_MODEL_ID — '${this.#model}' may have been retired. ` +
          `Current models: GET ${this.#baseUrl}/models.`,
      );
    } else if (response.status === 429) {
      const retryAfter = response.headers.get('retry-after');
      if (retryAfter !== null) parts.push(`Retry-After: ${retryAfter}s.`);
    }

    return this.#failure(parts.join(' — '), RETRYABLE_STATUSES.has(response.status));
  }

  #read(payload: GroqCompletion): Result<CompletionResult, ProviderError> {
    const choice = payload.choices?.[0];
    if (choice === undefined) {
      return err(this.#failure('Groq returned a completion with no choices.', true));
    }

    const message = choice.message;
    const text = typeof message?.content === 'string' ? message.content : '';

    const refused =
      choice.finish_reason === 'content_filter' ||
      (typeof message?.refusal === 'string' && message.refusal.length > 0);

    const toolCalls: ModelToolCall[] = [];
    for (const call of message?.tool_calls ?? []) {
      const name = call.function?.name;
      if (typeof call.id !== 'string' || typeof name !== 'string') {
        return err(this.#failure('Groq requested a tool without an id or a name.', true));
      }

      const parsed = parseArguments(call.function?.arguments);
      if (parsed === null) {
        return err(
          this.#failure(`Groq requested '${name}' with arguments that are not valid JSON.`, true),
        );
      }

      toolCalls.push({
        callId: call.id,
        toolId: trustExternalId<ToolId>(name),
        arguments: parsed,
      });
    }

    // Neither prose nor a tool call, and not a refusal, is not an answer. Passing
    // it through would surface a provider fault as a companion that chose to say
    // nothing — the one misreport this stage must never make.
    if (!refused && text.length === 0 && toolCalls.length === 0) {
      return err(
        this.#failure(
          `Groq returned an empty completion (finish_reason: ${choice.finish_reason ?? 'none'}).`,
          true,
        ),
      );
    }

    return ok({
      text,
      inputTokens: payload.usage?.prompt_tokens ?? 0,
      outputTokens: payload.usage?.completion_tokens ?? 0,
      cachedInputTokens: payload.usage?.prompt_tokens_details?.cached_tokens ?? 0,
      // Which model actually served it, which may differ from the one asked for.
      model: typeof payload.model === 'string' ? payload.model : this.#model,
      refused,
      toolCalls,
    });
  }

  #failure(message: string, retryable: boolean, cause?: unknown): ProviderError {
    return new ProviderError(message, {
      provider: this.name,
      retryable,
      ...(cause !== undefined ? { cause } : {}),
    });
  }
}

/**
 * Maps our messages onto the chat-completions shape.
 *
 * Tool results become one `tool` message per result, each carrying the id of
 * the call it answers. They are not flattened into user prose, for the same
 * reason as in the Anthropic adapter: that is how a transcript ends up
 * containing fabricated user turns the model then treats as real.
 */
const toGroqMessages = (messages: readonly ModelMessage[]): GroqMessage[] => {
  const mapped: GroqMessage[] = [];

  for (const message of messages) {
    switch (message.role) {
      case 'user':
        mapped.push({ role: 'user', content: message.content });
        break;

      case 'assistant':
        mapped.push({
          role: 'assistant',
          // Null rather than empty when the turn was purely a tool call: the
          // protocol treats an empty string as something the assistant said.
          content: message.content.length > 0 ? message.content : null,
          ...(message.toolCalls.length > 0
            ? {
                tool_calls: message.toolCalls.map((call) => ({
                  id: call.callId,
                  type: 'function' as const,
                  function: {
                    name: call.toolId,
                    arguments: JSON.stringify(call.arguments),
                  },
                })),
              }
            : {}),
        });
        break;

      case 'tool':
        for (const result of message.results) {
          mapped.push({
            role: 'tool',
            tool_call_id: result.callId,
            // This protocol has no error flag on a tool result, so failure is
            // stated in the content. Silently returning an error as if it were
            // output is how a companion confidently reports a calendar it never
            // reached.
            content: result.isError ? `Tool failed: ${result.content}` : result.content,
          });
        }
        break;
    }
  }

  return mapped;
};

const toGroqTool = (tool: Tool): GroqTool => ({
  type: 'function',
  function: {
    name: tool.id,
    description: tool.description,
    parameters: tool.parameters,
  },
});

/**
 * Reads a tool call's arguments, which arrive as a JSON *string*.
 *
 * Returns null rather than an empty object when the string will not parse. An
 * empty object is a valid argument set for a zero-parameter tool, so using it
 * as the failure value would run a tool with no arguments instead of reporting
 * that the model produced nonsense.
 */
const parseArguments = (raw: string | undefined): JsonObject | null => {
  if (raw === undefined || raw.trim().length === 0) return {};

  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    return parsed as JsonObject;
  } catch {
    return null;
  }
};

const describe = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

// ── the wire ────────────────────────────────────────────────────────────────
// Everything the API returns is optional and checked, because it is untrusted
// input: a response that changed shape must produce a reported failure, never a
// crash inside a turn that has already spent its budget.

interface GroqRequestBody {
  readonly model: string;
  readonly messages: readonly GroqMessage[];
  readonly max_completion_tokens: number;
  readonly temperature?: number;
  readonly tools?: readonly GroqTool[];
}

type GroqMessage =
  | { readonly role: 'system' | 'user'; readonly content: string }
  | {
      readonly role: 'assistant';
      readonly content: string | null;
      readonly tool_calls?: readonly GroqToolCall[];
    }
  | { readonly role: 'tool'; readonly tool_call_id: string; readonly content: string };

interface GroqToolCall {
  readonly id: string;
  readonly type: 'function';
  readonly function: { readonly name: string; readonly arguments: string };
}

interface GroqTool {
  readonly type: 'function';
  readonly function: {
    readonly name: string;
    readonly description: string;
    readonly parameters: JsonObject;
  };
}

interface GroqCompletion {
  readonly model?: string;
  readonly choices?: readonly {
    readonly finish_reason?: string;
    readonly message?: {
      readonly content?: string | null;
      readonly refusal?: string | null;
      readonly tool_calls?: readonly {
        readonly id?: string;
        readonly function?: { readonly name?: string; readonly arguments?: string };
      }[];
    };
  }[];
  readonly usage?: {
    readonly prompt_tokens?: number;
    readonly completion_tokens?: number;
    readonly prompt_tokens_details?: { readonly cached_tokens?: number };
  };
}

interface GroqErrorBody {
  readonly error?: { readonly message?: string };
}
