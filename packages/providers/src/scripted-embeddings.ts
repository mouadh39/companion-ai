import { type Result, type ProviderError, ok } from '@nexa/shared';
import type { EmbeddingPort, PortOptions } from '@nexa/core';

/**
 * An embedding provider that answers without a network call.
 *
 * The counterpart to {@link ScriptedLanguageModel}, and it exists for the same
 * reason: the whole pipeline — write path, vector column, candidate query,
 * ranking — must be runnable with no API key and no spend, or the tests that
 * cover it will not be run.
 *
 * ## It is not a pretend embedding model
 *
 * Nothing here approximates meaning, and no test should assert that it does. It
 * is a deterministic hash into a fixed number of buckets: the *same* text always
 * gives the *same* vector, and texts sharing terms give vectors that overlap.
 * That is enough to prove the plumbing carries a vector from provider to column
 * to query to ranker, which is what a unit test can honestly check.
 *
 * Whether a query about "coding language" actually finds a memory about Rust is
 * a claim about a real model, and it is verified against one — see the semantic
 * retrieval test, which requires a live provider and skips without it.
 */
export class ScriptedEmbeddingProvider implements EmbeddingPort {
  readonly model: string;
  readonly dimensions: number;

  constructor(dimensions = 1536, model = 'scripted-embedding-v1') {
    this.dimensions = dimensions;
    this.model = model;
  }

  get name(): string {
    return `scripted:${this.model}`;
  }

  async embed(
    inputs: readonly string[],
    _options: PortOptions,
  ): Promise<Result<readonly (readonly number[])[], ProviderError>> {
    return ok(inputs.map((input) => this.#vector(input)));
  }

  /**
   * Term-bucketed and L2-normalised.
   *
   * Normalised because cosine over unnormalised bags of counts is dominated by
   * length, and a store where longer memories always rank higher would hide a
   * genuine ordering bug behind a plausible-looking result.
   */
  #vector(input: string): readonly number[] {
    const vector = new Array<number>(this.dimensions).fill(0);

    for (const term of input.toLowerCase().split(/[^a-z0-9]+/u)) {
      if (term === '') continue;
      let hash = 2_166_136_261;
      for (let i = 0; i < term.length; i++) {
        hash ^= term.charCodeAt(i);
        hash = Math.imul(hash, 16_777_619);
      }
      const bucket = Math.abs(hash) % this.dimensions;
      vector[bucket] = (vector[bucket] ?? 0) + 1;
    }

    const norm = Math.sqrt(vector.reduce((total, value) => total + value * value, 0));
    if (norm === 0) return vector;
    return vector.map((value) => value / norm);
  }
}
