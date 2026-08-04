import type { EmbeddingReference } from '@nexa/models';
import { round } from './text.js';

/**
 * Semantic similarity, as arithmetic over data the caller supplies.
 *
 * This is how an engine that may not perform I/O still ranks on meaning.
 * Producing an embedding is a network call; *comparing* two of them is a dot
 * product, and a dot product is pure. So the vectors arrive as an argument and
 * the cosine happens here — deterministic, replayable, and identical on every
 * machine.
 *
 * The consequence worth stating plainly: **the caller decides how good this
 * engine's best dimension is.** A caller that supplies no index gets lexical
 * matching and a recorded `semantic_unavailable` degradation, which is a real
 * result rather than a silent one.
 */

/**
 * The query's vector and the candidates', keyed as the memories reference them.
 *
 * Keyed by `vectorId` rather than `MemoryId` because that is what
 * `EmbeddingReference` actually names, and the two are deliberately not the
 * same: one memory may be embedded more than once, and a re-embed must not
 * resolve to the old vector.
 */
export interface SemanticIndex {
  /** The model that produced every vector here, including the query's. */
  readonly model: string;
  readonly dimensions: number;
  /** The current message, embedded. */
  readonly query: readonly number[];
  readonly vectors: ReadonlyMap<string, readonly number[]>;
}

/**
 * Cosine similarity, clamped at zero.
 *
 * Negative cosines are discarded rather than rescaled into the middle of the
 * range. Mapping [-1,1] onto [0,1] would give a candidate that is *opposed* to
 * the query a semantic score of 0.5 — higher than most genuinely unrelated
 * material — which is precisely backwards for a signal whose job is to admit
 * things.
 */
export const cosine = (a: readonly number[], b: readonly number[]): number => {
  if (a.length === 0 || a.length !== b.length) return 0;

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    const left = a[i] ?? 0;
    const right = b[i] ?? 0;
    dot += left * right;
    normA += left * left;
    normB += right * right;
  }

  if (normA === 0 || normB === 0) return 0;

  return round(Math.max(0, dot / (Math.sqrt(normA) * Math.sqrt(normB))));
};

/** Why a candidate has no semantic score. */
export type SemanticMiss = 'no_index' | 'not_embedded' | 'incomparable' | 'vector_absent';

export interface SemanticScore {
  readonly similarity: number;
  /** Null when the score is real. Set when the dimension was unavailable. */
  readonly miss: SemanticMiss | null;
}

/**
 * How close a candidate is to the message, and when it cannot be told.
 *
 * The model and dimension check is not defensive noise. Cosine between vectors
 * from different embedding models returns a perfectly ordinary number that means
 * nothing at all — the arithmetic succeeds and the retrieval silently degrades,
 * which is far worse than an error. `EmbeddingReference` carries `model` for
 * exactly this check, and a mid-migration store where half the memories are
 * re-embedded is the normal case rather than the exotic one.
 */
export const similarityOf = (
  index: SemanticIndex | null,
  embedding: EmbeddingReference | null,
): SemanticScore => {
  if (index === null) return { similarity: 0, miss: 'no_index' };
  if (embedding === null) return { similarity: 0, miss: 'not_embedded' };

  if (embedding.model !== index.model || embedding.dimensions !== index.dimensions) {
    return { similarity: 0, miss: 'incomparable' };
  }

  const vector = index.vectors.get(embedding.vectorId);
  if (vector === undefined) return { similarity: 0, miss: 'vector_absent' };

  return { similarity: cosine(index.query, vector), miss: null };
};
