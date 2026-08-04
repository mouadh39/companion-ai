import type { Insight } from './reflection.js';
import type { Memory } from './memory.js';
import type { RelationshipProfile } from './relationship-profile.js';
import type { Timestamp } from '../value-objects/timestamp.js';

/**
 * The vocabulary of *what matters now*.
 *
 * Memory remembers, reflection understands, and retrieval decides which of the
 * two becomes active for one turn. Nothing here creates knowledge: every item is
 * a `Memory` or an `Insight` or a `RelationshipProfile` the caller already had,
 * wrapped in the reasoning that selected it.
 *
 * ## Why this is not `RetrievedMemory`
 *
 * `RetrievedMemory` and `RankingSignals` in `memory.ts` are Core's existing
 * contract and stay exactly as they are — Core reads them on every turn and this
 * package must not move under it. They describe one shape (a memory, five
 * signals); a retrieval engine that also ranks insights and relationship state
 * against a dozen dimensions needs a wider vocabulary, and widening theirs would
 * be a breaking change to the one interface the turn cannot afford to break.
 *
 * The two are bridged, not merged: `@nexa/retrieval` exports a pure projection
 * down to `readonly RetrievedMemory[]`, so the engine drops in behind
 * `MemoryRetrievalPort` without Core changing a line.
 *
 * ## Two stages, and this is the second
 *
 * Over years of history no pure function can look at everything. Candidate
 * *generation* — the vector search, the recency window, the subject filter —
 * belongs to the store, which has indexes. Candidate *selection* is this: given
 * a few hundred plausible things, decide which dozen matter now, and be able to
 * say why. Keeping the second stage pure is what makes a turn's context
 * reproducible; keeping the first stage out of it is what makes it scale.
 */

/**
 * What a retrieved thing is *about*.
 *
 * The budgeting and priority axis, deliberately about subject matter rather than
 * provenance. A habit the user stated and a habit reflection concluded are the
 * same kind of thing to a caller deciding how many habits are worth carrying, so
 * they share a class; where each came from is still on the item, in the payload.
 *
 * Every class is one the caller might plausibly want to cap, reserve, or
 * exclude — that is the test for belonging here.
 */
export type RetrievalClass =
  /** Who the user is. Name, work, where they live. */
  | 'identity'
  /** How they like things done. */
  | 'preference'
  /**
   * How they want to be talked to, and how they take things in.
   *
   * Split from `preference` rather than folded into it, because the two behave
   * differently at exactly the moment it matters. When someone says they are
   * frustrated, how they prefer to be addressed becomes relevant and what they
   * enjoy doing does not — and a single class cannot express that. The
   * consumers differ too: the expression engine wants this one and nothing else.
   */
  | 'communication'
  /** Something they are working toward. */
  | 'goal'
  /** An ongoing endeavour with no fixed end. */
  | 'project'
  /** A recurring behaviour. */
  | 'habit'
  /** A recurring behaviour with temporal regularity. */
  | 'routine'
  /** Something that happened and mattered. */
  | 'milestone'
  /** People in their life, and what the companion is to them. */
  | 'relationship'
  /** Something that happened lately. Decays fast, and should. */
  | 'recent_event'
  /** An understanding the companion arrived at rather than was told. */
  | 'reflection'
  /** Context for right now. Expected to stop mattering. */
  | 'temporary';

export const RETRIEVAL_CLASSES = [
  'identity',
  'preference',
  'communication',
  'goal',
  'project',
  'habit',
  'routine',
  'milestone',
  'relationship',
  'recent_event',
  'reflection',
  'temporary',
] as const satisfies readonly RetrievalClass[];

/**
 * Whether a thing is expected to still be true next month.
 *
 * Carried as its own axis rather than inferred from the class at each call site,
 * because it is what a caller most often actually wants: "give me what is stably
 * true about this person" and "give me what is going on right now" are different
 * questions, and answering both from one ranked list without this field means
 * every consumer re-deriving the same mapping slightly differently.
 */
export type Durability = 'durable' | 'temporary';

export const DURABILITIES = ['durable', 'temporary'] as const satisfies readonly Durability[];

/**
 * The independent dimensions a candidate is measured on.
 *
 * Twelve, scored separately and kept separately, because a single relevance
 * number is unexplainable and untunable — "why did you bring that up?" has no
 * answer beyond "it scored 0.68". Every one survives onto the item.
 *
 * They fall into two groups, and the split is the most important rule in the
 * engine. See `ANCHOR_SIGNALS`.
 */
export type SignalName =
  /** Cosine similarity against the message, over vectors the caller supplied. */
  | 'semantic'
  /** Term overlap with the message. Works with no vectors at all. */
  | 'lexical'
  /** The message named something this is about. */
  | 'entity'
  /** It bears on something the user is actively trying to do. */
  | 'goal_relevance'
  /** It is about what the last few turns were about. */
  | 'topic_continuity'
  /** It fits the emotional register the message was read in. */
  | 'emotional_fit'
  /** How lately, decayed against the class's own half-life. */
  | 'recency'
  /** How often it has been independently re-observed. */
  | 'reinforcement'
  /** How much it matters, as memory formation scored it. */
  | 'importance'
  /** How sure the companion is that it is true. */
  | 'confidence'
  /** For an insight, how much it has stopped moving. */
  | 'stability'
  /** How much this relationship licenses drawing on it. */
  | 'relationship_fit';

export const SIGNAL_NAMES = [
  'semantic',
  'lexical',
  'entity',
  'goal_relevance',
  'topic_continuity',
  'emotional_fit',
  'recency',
  'reinforcement',
  'importance',
  'confidence',
  'stability',
  'relationship_fit',
] as const satisfies readonly SignalName[];

/**
 * The signals that say "this is about *now*".
 *
 * **Only these can admit an item.** The rest — recency, importance, confidence,
 * stability, reinforcement, relationship fit — can raise or lower something that
 * already earned its way in, and can never let anything in on their own.
 *
 * That single rule is what separates a retrieval engine from a "most important
 * memories" list. Without it, a highly important, frequently reinforced,
 * perfectly confident memory about the user's pizza order outranks a middling
 * one about Unity on a turn that was entirely about Unity — because importance
 * is a property of the memory and relevance is a property of the *moment*, and
 * only one of them was asked about.
 *
 * Importance is a tiebreaker. It is never a ticket.
 */
export const ANCHOR_SIGNALS = [
  'semantic',
  'lexical',
  'entity',
  'goal_relevance',
  'topic_continuity',
  'emotional_fit',
] as const satisfies readonly SignalName[];

/** Every dimension, scored 0–1. Total: an unmeasurable signal is 0, never absent. */
export type RelevanceSignals = Readonly<Record<SignalName, number>>;

/** Why an item was selected, or why a candidate was not. */
export type RetrievalReasonCode =
  | 'anchored_semantically'
  | 'anchored_lexically'
  | 'entity_mentioned'
  | 'serves_goal'
  | 'continues_topic'
  | 'matches_emotion'
  | 'scored'
  | 'recent'
  | 'reinforced'
  | 'high_importance'
  | 'well_evidenced'
  | 'stable'
  | 'relationship_relevant'
  | 'reserved_slot'
  | 'boundary_flagged'
  | 'subsumed_by_insight'
  | 'duplicate_collapsed'
  | 'candidates_truncated'
  | 'semantic_unavailable'
  | 'budget_exhausted'
  | 'below_threshold';

export const RETRIEVAL_REASON_CODES = [
  'anchored_semantically',
  'anchored_lexically',
  'entity_mentioned',
  'serves_goal',
  'continues_topic',
  'matches_emotion',
  'scored',
  'recent',
  'reinforced',
  'high_importance',
  'well_evidenced',
  'stable',
  'relationship_relevant',
  'reserved_slot',
  'boundary_flagged',
  'subsumed_by_insight',
  'duplicate_collapsed',
  'candidates_truncated',
  'semantic_unavailable',
  'budget_exhausted',
  'below_threshold',
] as const satisfies readonly RetrievalReasonCode[];

export interface RetrievalReason {
  readonly code: RetrievalReasonCode;
  readonly detail: string;
}

/** What kind of thing an item wraps. Never a new kind of knowledge. */
export type RetrievalSource = 'memory' | 'insight' | 'relationship';

export const RETRIEVAL_SOURCES = [
  'memory',
  'insight',
  'relationship',
] as const satisfies readonly RetrievalSource[];

/** Everything true of a retrieved item whatever it wraps. */
interface RetrievedBase {
  /** 1-based position in the returned order. Stable for identical input. */
  readonly rank: number;
  readonly retrievalClass: RetrievalClass;
  readonly durability: Durability;
  /** Combined relevance, 0–1. Never the whole story — see `signals`. */
  readonly score: number;
  readonly signals: RelevanceSignals;
  /**
   * The anchoring signal that admitted this, and how strongly.
   *
   * Kept separately from `signals` because it is the answer to "why is this here
   * at all?", as distinct from "why is it this high?". The two come apart
   * constantly: an item can be admitted by a bare entity mention and ranked by
   * importance, and a reader given only the score would conclude the wrong thing
   * about what the engine was responding to.
   */
  readonly anchor: SignalName;
  readonly anchorStrength: number;
  readonly reasons: readonly RetrievalReason[];
  /**
   * Identity boundary domains this touches, by id.
   *
   * A flag, never a filter. Retrieval does not hide the user's own memories
   * because the companion is careful about a subject — suppressing what someone
   * told you about themselves is not caution, it is amnesia with a policy
   * attached. Generation decides how to speak; this only makes sure it knows.
   */
  readonly boundaries: readonly string[];
  /** What this contributes to a prompt, for token accounting. */
  readonly text: string;
  readonly estimatedTokens: number;
}

/**
 * One thing that should be active this turn.
 *
 * A discriminated union rather than a record with three optional payloads, so a
 * caller cannot read `.memory` on an insight. The three genuinely differ in what
 * downstream can do with them — a memory can be quoted, an insight must be
 * hedged, a relationship profile is a stance rather than a fact — and a shape
 * that let them be confused would put that difference in a runtime check nobody
 * performs.
 */
export type RetrievalItem =
  | (RetrievedBase & { readonly source: 'memory'; readonly memory: Memory })
  | (RetrievedBase & { readonly source: 'insight'; readonly insight: Insight })
  | (RetrievedBase & {
      readonly source: 'relationship';
      readonly relationship: RelationshipProfile;
    });

/** Why a candidate did not make it. */
export type ExclusionReason =
  /** Expired, retired, superseded, or under the confidence a candidate needs. */
  | 'not_eligible'
  /** Nothing about it was about now. The commonest reason, and the point. */
  | 'below_relevance_floor'
  /** Another candidate already says this. */
  | 'duplicate'
  /** An insight drawn from it was selected, which already carries the point. */
  | 'subsumed_by_insight'
  /** Its class had taken its share. */
  | 'class_cap'
  /** Relevant, but the item budget ran out above it. */
  | 'budget_items'
  /** Relevant, but it did not fit the token budget. */
  | 'budget_tokens';

export const EXCLUSION_REASONS = [
  'not_eligible',
  'below_relevance_floor',
  'duplicate',
  'subsumed_by_insight',
  'class_cap',
  'budget_items',
  'budget_tokens',
] as const satisfies readonly ExclusionReason[];

/**
 * A candidate that was considered and left out.
 *
 * "Why not something else?" is half of explainability and the half usually
 * discarded. It carries the strongest signal the candidate managed, so a reader
 * can tell "nothing about it was relevant" from "it was relevant and lost on
 * budget" — two very different bugs.
 */
export interface ExcludedCandidate {
  /** `MemoryId` or `InsightId`, as a plain string — this crosses both. */
  readonly id: string;
  readonly source: RetrievalSource;
  readonly retrievalClass: RetrievalClass;
  readonly reason: ExclusionReason;
  readonly detail: string;
  readonly bestSignal: SignalName;
  readonly bestSignalStrength: number;
}

/**
 * What one retrieval is allowed to spend.
 *
 * Three ceilings rather than one, because they fail differently. Items bound how
 * much the companion is *thinking about*; tokens bound what it *costs*; the
 * per-class caps bound how *lopsided* it can get. A single limit cannot express
 * "at most twelve things, at most 5000 tokens, and never more than three of them
 * temporary" — and the third is what stops one busy afternoon from crowding out
 * everything known about a person.
 */
export interface RetrievalBudget {
  readonly maxItems: number;
  readonly maxTokens: number;
  /** Per-class ceilings. Absent means uncapped beyond `maxItems`. */
  readonly maxPerClass: Readonly<Partial<Record<RetrievalClass, number>>>;
  /**
   * Slots held for a class before open competition.
   *
   * Reserved slots are filled by that class's best-anchored candidates and **do
   * not bypass the relevance floor**. They exist so that a turn flooded with one
   * kind of match still carries the others — not so that irrelevant things get
   * in by category.
   */
  readonly reserved: Readonly<Partial<Record<RetrievalClass, number>>>;
}

export interface BudgetSpend {
  readonly items: number;
  readonly tokens: number;
  readonly perClass: Readonly<Partial<Record<RetrievalClass, number>>>;
}

/**
 * A dimension the ranking could not use, or a ceiling that bound the result.
 *
 * Recorded rather than inferred, the same choice `SectionOmission` makes and for
 * the same reason: a caller cannot tell a thin result caused by a sparse history
 * from one caused by a missing vector index, and those call for opposite
 * responses.
 */
export type DegradationReason =
  /** No vectors supplied, so ranking ran without its strongest dimension. */
  | 'semantic_unavailable'
  /** Some candidates could not be compared — a different embedding model. */
  | 'embeddings_incomparable'
  /** The caller said its candidate set was cut short. There may be more. */
  | 'candidates_truncated'
  /** The item ceiling bound the result. */
  | 'budget_items'
  /** The token ceiling bound the result. */
  | 'budget_tokens'
  /** No goals supplied, so goal relevance scored zero throughout. */
  | 'goals_unavailable'
  /** No relationship supplied, so relationship fit scored neutral throughout. */
  | 'relationship_unavailable';

export const DEGRADATION_REASONS = [
  'semantic_unavailable',
  'embeddings_incomparable',
  'candidates_truncated',
  'budget_items',
  'budget_tokens',
  'goals_unavailable',
  'relationship_unavailable',
] as const satisfies readonly DegradationReason[];

export interface Degradation {
  readonly reason: DegradationReason;
  readonly detail: string;
}

/**
 * What retrieval decided, and everything needed to argue with it.
 *
 * `excludedCount` is complete even when `excluded` has been truncated to the
 * configured limit. Over years of history the excluded list is the one part of
 * this result that grows without bound, so it is capped — but a truncated list
 * paired with an honest total is inspectable, whereas a truncated list alone
 * quietly understates how much was passed over.
 */
export interface RetrievalOutcome {
  readonly items: readonly RetrievalItem[];
  readonly excluded: readonly ExcludedCandidate[];
  readonly consideredCount: number;
  readonly excludedCount: number;
  readonly spend: BudgetSpend;
  readonly degraded: readonly Degradation[];
  /** Pass-level reasoning. Per-item reasoning lives on each item. */
  readonly reasons: readonly RetrievalReason[];
  /** The instant the retrieval was made against. Never a clock reading. */
  readonly at: Timestamp;
}
