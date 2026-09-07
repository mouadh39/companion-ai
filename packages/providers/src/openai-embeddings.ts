import { type Result, ProviderError, err, ok } from '@nexa/shared';
import type { EmbeddingPort, PortOptions } from '@nexa/core';

/**
 * OpenAI implementation of {@link EmbeddingPort}.
 *
 * Everything OpenAI-specific is confined to this file, exactly as it is for the
 * language models. `@nexa/retrieval` compares vectors and never learns where
 * they came from, which is what lets a different provider — or a local model —
 * replace this without touching ranking.
 *
 * ## Why `fetch` and not the SDK
 *
 * The embeddings endpoint is one POST with three fields. A vendor SDK would add
 * a dependency, a second retry policy layered under Core's deadline, and its own
 * error taxonomy to translate, for a request this file expresses in one object.
 *
 * ## Dimensions are declared, not discovered
 *
 * `dimensions` is configuration rather than something read back from the first
 * response, because the database column is `vector(1536)` and a mismatch must
 * fail at startup rather than on the first insert. It is also sent to the API:
 * `text-embedding-3-*` can return shortened vectors, and asking for the width
 * the schema expects is cheaper than discovering the difference later.
 */

export interface OpenAiEmbeddingOptions {
  readonly apiKey: string;
  /** Defaults to `text-embedding-3-small`. */
  readonly model?: string;
  /** Defaults to 1536, matching the `memories.embedding` column. */
  readonly dimensions?: number;
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
  /** Injected by tests. Production uses the platform `fetch`. */
  readonly fetchImpl?: typeof fetch;
}

interface EmbeddingResponse {
  readonly data?: readonly { readonly index: number; readonly embedding: readonly number[] }[];
  readonly error?: { readonly message?: string; readonly code?: string };
}

const DEFAULT_MODEL = 'text-embedding-3-small';
const DEFAULT_DIMENSIONS = 1536;

export class OpenAiEmbeddingProvider implements EmbeddingPort {
  readonly model: string;
  readonly dimensions: number;
  readonly #apiKey: string;
  readonly #endpoint: string;
  readonly #timeoutMs: number;
  readonly #fetch: typeof fetch;

  constructor(options: OpenAiEmbeddingOptions) {
    this.model = options.model ?? DEFAULT_MODEL;
    this.dimensions = options.dimensions ?? DEFAULT_DIMENSIONS;
    this.#apiKey = options.apiKey;
    this.#endpoint = `${(options.baseUrl ?? 'https://api.openai.com').replace(/\/+$/u, '')}/v1/embeddings`;
    this.#timeoutMs = options.timeoutMs ?? 20_000;
    this.#fetch = options.fetchImpl ?? fetch;
  }

  get name(): string {
    return `openai:${this.model}`;
  }

  async embed(
    inputs: readonly string[],
    options: PortOptions,
  ): Promise<Result<readonly (readonly number[])[], ProviderError>> {
    if (inputs.length === 0) return ok([]);

    // Core already scopes every port call to what remains of the turn. This is a
    // backstop beneath that, not a replacement for it.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#timeoutMs);
    const abort = (): void => controller.abort();
    options.signal?.addEventListener('abort', abort);

    try {
      const response = await this.#fetch(this.#endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.#apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          input: [...inputs],
          dimensions: this.dimensions,
        }),
        signal: controller.signal,
      });

      const body = (await response.json()) as EmbeddingResponse;

      if (!response.ok) {
        return err(
          new ProviderError(
            `OpenAI embeddings returned ${String(response.status)}` +
              (body.error?.message === undefined ? '' : ` — ${body.error.message}`),
            {
              provider: this.name,
              // 429 and 5xx are worth another attempt; a 401 or a malformed
              // request will fail identically forever.
              retryable: response.status === 429 || response.status >= 500,
            },
          ),
        );
      }

      const data = body.data;
      if (data === undefined || data.length !== inputs.length) {
        return err(
          new ProviderError(
            `OpenAI embeddings returned ${String(data?.length ?? 0)} vectors for ${String(inputs.length)} inputs.`,
            { provider: this.name, retryable: false },
          ),
        );
      }

      // Sorted by index rather than trusted in order. The contract is positional
      // and a reordered batch would silently attach every vector to the wrong
      // memory — a corruption no later check could detect.
      const ordered = [...data].sort((a, b) => a.index - b.index).map((entry) => entry.embedding);

      const wrong = ordered.find((vector) => vector.length !== this.dimensions);
      if (wrong !== undefined) {
        return err(
          new ProviderError(
            `OpenAI returned ${String(wrong.length)}-dimension vectors; ${String(this.dimensions)} was requested.`,
            { provider: this.name, retryable: false },
          ),
        );
      }

      return ok(ordered);
    } catch (error) {
      return err(
        new ProviderError(
          `Could not reach OpenAI embeddings: ${error instanceof Error ? error.message : String(error)}`,
          { provider: this.name, retryable: true, cause: error },
        ),
      );
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);
    }
  }
}
