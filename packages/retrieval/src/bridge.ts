import type {
  RetrievalItem,
  RetrievalOutcome,
  RankingSignals,
  RetrievedMemory,
} from '@nexa/models';
import { confidence as asConfidence } from '@nexa/models';

/**
 * The projection down to Core's existing contract.
 *
 * `MemoryRetrievalPort` returns `readonly RetrievedMemory[]`, and Core reads it
 * on the critical path of every turn. Widening that interface to carry twelve
 * signals, insights and relationship state would be a breaking change to the one
 * contract the turn cannot afford to break — so this engine does not touch it.
 * It projects instead.
 *
 * The projection is lossy and it is meant to be. `RetrievedMemory` describes a
 * memory with five signals; an outcome that also ranked insights has nowhere to
 * put them, so they are dropped rather than flattened into something that reads
 * like a memory. **An insight rendered as a memory would be the one confusion
 * this whole subsystem exists to prevent** — a conclusion the companion drew,
 * arriving in context as though the user had said it.
 *
 * The full outcome remains available to any caller that wants it. Core gets the
 * memories; a later Core that grows an insights section gets the rest without
 * this function changing.
 */

/**
 * Maps this engine's twelve dimensions onto Core's five.
 *
 * Each of Core's signals is filled from the dimension that means the same thing,
 * and `semantic` falls back to lexical when no vectors were supplied. That
 * fallback is the honest choice for a field named `semantic`: the alternative is
 * reporting zero, which would tell a reader the memory was semantically
 * unrelated when in fact nothing was measured.
 */
const project = (item: RetrievalItem): RankingSignals => ({
  semantic: item.signals.semantic > 0 ? item.signals.semantic : item.signals.lexical,
  recency: item.signals.recency,
  importance: item.signals.importance,
  goalRelevance: item.signals.goal_relevance,
  // Core's `emotionalSalience` is about how charged a memory is; the closest
  // thing measured here is how much the moment's emotional register made it
  // relevant. Related, not identical, and worth saying so out loud rather than
  // leaving a reader to assume they are the same measurement.
  emotionalSalience: item.signals.emotional_fit,
});

export const toRetrievedMemories = (
  outcome: RetrievalOutcome,
): readonly RetrievedMemory[] =>
  outcome.items
    .filter((item): item is Extract<RetrievalItem, { source: 'memory' }> =>
      item.source === 'memory',
    )
    .map((item) => ({
      memory: item.memory,
      score: asConfidence(item.score),
      signals: project(item),
    }));
