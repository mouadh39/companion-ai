/**
 * `@nexa/retrieval` — what matters *now*.
 *
 * Memory remembers, reflection understands, and this decides which of the two
 * becomes active for one turn. It creates nothing: every item it returns is a
 * `Memory` or an `Insight` or a `RelationshipProfile` the caller already had,
 * handed back with the reasoning that selected it.
 *
 * ```ts
 * retrieve(request)              → RetrievalOutcome
 * toRetrievedMemories(outcome)   → readonly RetrievedMemory[]   // Core's contract
 * ```
 *
 * Pure, total, clock-free, model-free and store-free. Every input arrives as an
 * argument — the candidates, the instant, the vectors, the budget — and each is
 * somewhere an ordinary implementation would reach for the environment. Identical
 * input produces byte-identical output, so a turn's context can be reconstructed
 * from its log and "why did you bring that up?" is answerable a year later.
 *
 * ## Importance is a tiebreaker, never a ticket
 *
 * The single rule that makes this a retrieval engine rather than a
 * most-important-memories list. Twelve signals are measured, and only six of them
 * — semantic, lexical, entity, goal relevance, topic continuity, emotional fit —
 * can *admit* anything. The other six can raise or lower something that already
 * earned its way in and can never let anything in on their own.
 *
 * Without that split, a perfectly confident, frequently reinforced, highly
 * important memory about someone's pizza order outranks a middling one about
 * Unity on a turn entirely about Unity. Importance is a property of the memory;
 * relevance is a property of the moment; only one of them was asked about.
 *
 * ## Built to be argued with
 *
 * Every item carries all twelve signals, which dimension admitted it and how
 * strongly, and which dimensions could be measured at all. Every candidate that
 * did not make it is reported with the best signal it managed — so "nothing about
 * it was relevant" and "it was relevant and lost on budget" are distinguishable,
 * which they need to be, because they are opposite bugs.
 *
 * ## Two stages, and this is the second
 *
 * Over years of history no pure function can look at everything, and this one
 * does not try. Candidate *generation* — vector search, recency window, subject
 * filter — belongs to the store, which has indexes and may perform I/O. This is
 * candidate *selection*: given a few hundred plausible things, choose the dozen
 * that matter. The engine's cost is therefore a function of the candidate set the
 * caller chose, not of how long the companion has known someone — which is what
 * lets a design that stays explainable also stay affordable at year five.
 *
 * ## Measured, not merely scored
 *
 * A dimension that cannot be measured for a candidate is excluded from its
 * average rather than scored zero. A memory awaiting embedding is not a worse
 * memory, and an insight has no importance because reflection does not score
 * one — penalising either for a field that never applied is how a store mid-way
 * through a re-embed quietly reorders itself.
 *
 * ## Where the vocabulary lives
 *
 * `RetrievalItem`, `RetrievalOutcome`, `RelevanceSignals` and the rest are in
 * `@nexa/models`. They have to be: `@nexa/core` may never import a capability
 * package, so anything Core or a sibling engine reads sits beneath both. This
 * package holds the rules, not their shapes.
 */

export type { RetrievalRequest } from './retrieve.js';
export { retrieve } from './retrieve.js';

export { toRetrievedMemories } from './bridge.js';

export type { RetrievalConfig } from './config.js';
export { DEFAULT_CONFIG } from './config.js';

export type { ClassPolicy } from './classes.js';
export {
  CLASS_POLICIES,
  policyFor,
  classOfMemory,
  classOfInsight,
  insightIsLive,
  MAX_SINGLE_WEIGHT,
  NO_SIGNALS,
} from './classes.js';

export type { RetrievalQuery, QueryInputs, GoalTerms } from './query.js';
export {
  deriveQuery,
  isSupportive,
  TOPIC_WINDOW_TURNS,
  SUPPORTIVE_DIMENSIONS,
  EMOTIONALLY_RELEVANT_CLASSES,
} from './query.js';

export type { Candidate, CandidatePayload, IneligibleReason } from './candidates.js';
export {
  candidateOfMemory,
  candidateOfInsight,
  candidateOfRelationship,
  memoryEligibility,
  insightEligibility,
  relationshipFit,
  REINFORCEMENT_SATURATION,
  EVIDENCE_SATURATION,
  COLLABORATION_SATURATION,
} from './candidates.js';

export type { SemanticIndex, SemanticScore, SemanticMiss } from './semantic.js';
export { cosine, similarityOf } from './semantic.js';

export type { SignalReading } from './signals.js';
export {
  measure,
  decay,
  ENTITY_FLOOR,
  EMOTIONAL_ANCHOR_CEILING,
  EMOTIONAL_ANCHOR_FLOOR,
} from './signals.js';

export type { Ranked, RankInputs } from './rank.js';
export { rank, anchorOf, scoreOf, byRank, MIN_MEASURED_SIGNALS } from './rank.js';

export type { DedupeResult } from './dedupe.js';
export { dedupe } from './dedupe.js';

export type { FitResult } from './budget.js';
export { fit, defaultBudget, estimateTokens } from './budget.js';

export { terms, stem, words, coverage, overlap, mentions } from './text.js';
