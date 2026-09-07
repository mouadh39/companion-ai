import type { CompanionId, InsightId, MemoryId, UserId } from '@nexa/shared';
import type { MemorySource } from '../enums/memory.js';
import type { ConfidenceScore } from '../value-objects/score.js';
import type { Timestamp } from '../value-objects/timestamp.js';
import type { Brand } from '../types/brand.js';

/**
 * The vocabulary of understanding.
 *
 * Memory remembers; reflection understands. The distinction is enforced here
 * rather than left to convention: an `Insight` is a different entity from a
 * `Memory`, with a different identifier, a different lifecycle and a different
 * confidence story. Nothing in this file can be passed where a `Memory` belongs.
 *
 * ## An Insight is not a Memory
 *
 * A memory represents something that happened, and it is the user's property.
 * An insight represents a conclusion drawn *from* several memories, and it is
 * the companion's. Blurring them produces the failure this whole engine exists
 * to prevent: a companion that recalls its own guesses as though the user had
 * said them.
 *
 * Two consequences follow, and both are load-bearing:
 *
 * 1. **Evidence is held by reference.** `InsightEvidence` carries memory ids and
 *    provenance, never memory *content*. An insight that copied the text would
 *    be a shadow memory store with none of memory's retention or deletion
 *    guarantees — and `18_Memory_Architecture.md` gives the user the right to
 *    delete. Deleting a memory must not leave its words behind in a conclusion.
 * 2. **No insight is permanent.** Every kind has a finite life. Understanding
 *    that is never re-earned is understanding that has stopped tracking the
 *    person it is about.
 */

/**
 * What sort of understanding an insight expresses.
 *
 * A closed list, deliberately. Reflection is allowed to notice these things and
 * nothing else — an open-ended "the companion concluded something" would have no
 * grammar to phrase it in and no policy to govern how long it lives, and would
 * become the seam through which a model-generated claim entered a store that
 * promises to hold only derived ones.
 *
 * `condition` is the one that names a present state rather than a stable trait
 * ("may currently be overworking"), and it is the most tightly capped for that
 * reason. A trait misjudged is a companion that misreads someone; a *state*
 * misjudged and asserted confidently is a companion diagnosing them.
 */
export type InsightKind =
  /** How they like things done. */
  | 'preference'
  /** What they are drawn to. */
  | 'interest'
  /** A recurring behaviour. */
  | 'habit'
  /** A recurring behaviour with temporal regularity. */
  | 'routine'
  /** What matters to them, as distinct from what they enjoy. */
  | 'value'
  /** Something they appear to be working toward. */
  | 'goal'
  /** Something they keep finding hard. */
  | 'struggle'
  /** Something that keeps going well. */
  | 'strength'
  /** How they want to be talked to. */
  | 'communication'
  /** How they take things in. */
  | 'learning_style'
  /** A present state, never a diagnosis. Always hedged, always short-lived. */
  | 'condition';

export const INSIGHT_KINDS = [
  'preference',
  'interest',
  'habit',
  'routine',
  'value',
  'goal',
  'struggle',
  'strength',
  'communication',
  'learning_style',
  'condition',
] as const satisfies readonly InsightKind[];

/**
 * Where an insight stands right now.
 *
 * `contested` is the state that keeps this engine honest. Without it a
 * disagreement has only two resolutions — ignore the new evidence or overwrite
 * the old conclusion — and both are ways of pretending the companion is surer
 * than it is. Holding a contested insight visibly, at reduced confidence, is
 * what lets "I thought you preferred X, but you've said otherwise recently"
 * exist as a sentence.
 *
 * `superseded` and `retired` are terminal. Neither deletes anything: the record
 * stays readable so the path to the current understanding survives.
 */
export type InsightStatus = 'active' | 'contested' | 'superseded' | 'retired';

export const INSIGHT_STATUSES = [
  'active',
  'contested',
  'superseded',
  'retired',
] as const satisfies readonly InsightStatus[];

/**
 * How sure an insight is, as a band rather than a number.
 *
 * The band, not the score, decides the wording — which is what stops phrasing
 * from drifting continuously with arithmetic nobody can see. Three bands, and
 * **there is no `certain`**. Reflection concludes; it does not observe, and a
 * conclusion drawn from a handful of remarks about a person is never certain
 * however many remarks there were.
 *
 * `CertaintyBand` in `identity-profile.ts` is a different scale for a different
 * job — how sure Nexa is about *itself*, where `certain` is legitimate because
 * identity is declared rather than inferred.
 */
export type InsightCertainty = 'tentative' | 'probable' | 'confident';

export const INSIGHT_CERTAINTIES = [
  'tentative',
  'probable',
  'confident',
] as const satisfies readonly InsightCertainty[];

export const CERTAINTY_RANK = {
  tentative: 0,
  probable: 1,
  confident: 2,
} as const satisfies Readonly<Record<InsightCertainty, number>>;

/**
 * Which way the claim points.
 *
 * Carried explicitly rather than folded into the statement text, because
 * everything downstream needs to reason about it: a memory that denies what an
 * insight affirms is opposing evidence, and detecting that by parsing English
 * back out of `statement` would be a parser nobody wants to own.
 */
export type InsightPolarity = 'affirms' | 'denies';

export const INSIGHT_POLARITIES = [
  'affirms',
  'denies',
] as const satisfies readonly InsightPolarity[];

/**
 * The stable identity of a claim: `kind:topicKey`.
 *
 * Derived from *what the claim is about*, not from when it was made, so the
 * same pattern observed a year apart resolves to the same key and reconciliation
 * is a map lookup rather than a fuzzy match. That is what makes a reflection
 * pass replayable — matching by similarity would make the result depend on which
 * insights happened to be loaded.
 *
 * **Unique among active insights, not across history.** A claim that flips
 * polarity is replaced, and the superseded record keeps the same key.
 */
export type InsightKey = Brand<string, 'InsightKey'>;

export const insightKey = (kind: InsightKind, topicKey: string): InsightKey =>
  `${kind}:${topicKey}` as InsightKey;

/**
 * One memory's contribution to an insight, by reference.
 *
 * **No content.** The fields here are enough to rank, date and explain the
 * evidence, and resolving it back to words is a read against the memory store —
 * which is the only place with the user's deletion and retention guarantees. An
 * insight that cached excerpts would survive the deletion of what it quotes.
 */
export interface InsightEvidence {
  readonly memoryId: MemoryId;
  /** When the memory was formed. Never when the insight read it. */
  readonly at: Timestamp;
  readonly source: MemorySource;
  readonly polarity: InsightPolarity;
  /** How much this memory corroborates, 0–1. Provenance times memory confidence. */
  readonly weight: number;
}

/**
 * Which rules produced this, and from what window.
 *
 * `ruleset` is a version tag rather than decoration. Formation rules will be
 * tuned, and an insight formed under an older ruleset is one whose confidence
 * cannot be compared to a newer one's — knowing which produced it is the
 * difference between re-deriving the store and guessing at it.
 */
export interface InsightProvenance {
  readonly ruleset: string;
  /** Earliest evidence timestamp considered by the pass that formed it. */
  readonly windowFrom: Timestamp;
  /** Latest evidence timestamp considered by that pass. */
  readonly windowTo: Timestamp;
}

/** What happened to an insight, and what it did to the numbers. */
export type InsightChangeKind =
  | 'formed'
  | 'reinforced'
  | 'weakened'
  | 'contested'
  | 'revised'
  | 'replaced'
  | 'decayed'
  | 'retired';

export const INSIGHT_CHANGE_KINDS = [
  'formed',
  'reinforced',
  'weakened',
  'contested',
  'revised',
  'replaced',
  'decayed',
  'retired',
] as const satisfies readonly InsightChangeKind[];

/**
 * One entry in an insight's history.
 *
 * Carries the confidence either side of the change, so "why is it surer than it
 * was?" is answerable from the record alone rather than by re-running the
 * engine against evidence that may since have been deleted.
 */
export interface InsightChange {
  readonly kind: InsightChangeKind;
  readonly at: Timestamp;
  readonly detail: string;
  readonly confidenceBefore: ConfidenceScore;
  readonly confidenceAfter: ConfidenceScore;
}

/**
 * A durable understanding derived from several memories.
 *
 * Everything needed to assert it, doubt it, rank it, explain it and let it go.
 * The fields that look like bookkeeping are the ones that carry the promise:
 * `supporting` and `opposing` make the claim auditable, `revision` and `history`
 * make it explainable, `expiresAt` makes it temporary.
 */
export interface Insight {
  readonly id: InsightId;
  readonly userId: UserId;
  /** Which companion formed it. The other half of the ownership boundary. */
  readonly companionId: CompanionId;
  /** `kind:topicKey`. Unique among this user's active insights. */
  readonly key: InsightKey;
  readonly kind: InsightKind;
  /**
   * The stable topic identity — a theme id or a normalised literal token.
   *
   * Distinct from `topic` because one is machine identity and the other is
   * language. Keying on the readable label would make an insight's identity
   * depend on how it was phrased.
   */
  readonly topicKey: string;
  /** The readable topic, as it appears inside `statement`. */
  readonly topic: string;
  readonly polarity: InsightPolarity;
  /**
   * The claim, in natural language, hedged to match `certainty`.
   *
   * Composed from a fixed template, never generated. A sentence a model wrote
   * is a sentence nobody can predict, and this one is asserted to the user as
   * something the companion believes about them.
   */
  readonly statement: string;
  readonly status: InsightStatus;
  readonly certainty: InsightCertainty;
  /** What is believed now, after any time-based decay. */
  readonly confidence: ConfidenceScore;
  /**
   * What the evidence alone supports, before decay.
   *
   * Held separately so decay is a pure function of `lastSupportedAt` rather than
   * of the last time a maintenance pass happened to run. Without it, running
   * the pass twice in a day would decay an insight twice.
   */
  readonly evidenceConfidence: ConfidenceScore;
  /**
   * How much the insight has stopped moving, 0–1.
   *
   * Corroboration tempered by churn: revisions and opposing evidence both push
   * it down. A high-confidence insight that has been revised three times is not
   * a settled one, and a consumer that treated confidence as stability would
   * keep asserting a claim that is visibly still in flux.
   */
  readonly stability: number;
  readonly supporting: readonly InsightEvidence[];
  readonly opposing: readonly InsightEvidence[];
  readonly createdAt: Timestamp;
  readonly updatedAt: Timestamp;
  /** When supporting evidence was last added. Decay measures from here. */
  readonly lastSupportedAt: Timestamp;
  /** Null only if a policy ever declares a kind permanent. None currently does. */
  readonly expiresAt: Timestamp | null;
  /** How many times the statement has been rewritten for the same claim. */
  readonly revision: number;
  /** The insight this replaced, when a claim flipped. */
  readonly supersedes: InsightId | null;
  readonly supersededBy: InsightId | null;
  /** Set only when `status` is `retired`. */
  readonly retirement: InsightRetirement | null;
  readonly provenance: InsightProvenance;
  /** Most recent first, bounded by the engine's configured limit. */
  readonly history: readonly InsightChange[];
}

/**
 * An insight the engine has decided to form, before an id exists.
 *
 * No `id`, no `userId` and no `supersededBy`, for the same reason `MemoryDraft`
 * has no id: the engine mints nothing. Identifier generation is randomness, and
 * an engine that generated ids could not produce identical output for identical
 * input.
 */
export interface InsightDraft {
  readonly key: InsightKey;
  readonly kind: InsightKind;
  readonly topicKey: string;
  readonly topic: string;
  readonly polarity: InsightPolarity;
  readonly statement: string;
  readonly status: InsightStatus;
  readonly certainty: InsightCertainty;
  readonly confidence: ConfidenceScore;
  readonly evidenceConfidence: ConfidenceScore;
  readonly stability: number;
  readonly supporting: readonly InsightEvidence[];
  readonly opposing: readonly InsightEvidence[];
  readonly createdAt: Timestamp;
  readonly updatedAt: Timestamp;
  readonly lastSupportedAt: Timestamp;
  readonly expiresAt: Timestamp | null;
  readonly revision: number;
  /** Set when this draft replaces a flipped claim. */
  readonly supersedes: InsightId | null;
  readonly provenance: InsightProvenance;
  readonly history: readonly InsightChange[];
}

/**
 * The new state of an insight after evidence or time moved it.
 *
 * **Absolute values, not deltas** — the opposite of `Reinforcement` in memory
 * formation, and deliberately so. A memory's confidence is a running belief
 * nudged by events, so a delta is the honest description of what happened. An
 * insight's confidence is a *function of the evidence it lists*; nudging it
 * would let the number drift away from the evidence set printed beside it, and
 * "why do you think that?" would stop being answerable from the record.
 *
 * `change` is the history entry to append, carrying confidence either side.
 */
export interface InsightAdjustment {
  readonly confidence: ConfidenceScore;
  readonly evidenceConfidence: ConfidenceScore;
  readonly certainty: InsightCertainty;
  readonly stability: number;
  readonly status: InsightStatus;
  readonly statement: string;
  readonly revision: number;
  readonly supporting: readonly InsightEvidence[];
  readonly opposing: readonly InsightEvidence[];
  readonly expiresAt: Timestamp | null;
  readonly lastSupportedAt: Timestamp;
  readonly updatedAt: Timestamp;
  readonly change: InsightChange;
}

/**
 * Why an insight left circulation.
 *
 * As with forgetting, none of these means deletion. `evidence_withdrawn` is the
 * one that answers to the user directly: when the memories an insight rests on
 * are deleted, the conclusion drawn from them must go too, or deletion would be
 * a promise the companion only half kept.
 */
export type InsightRetirement =
  /** Its kind's life ran out without further support. */
  | 'expired'
  /** Confidence decayed below the floor its kind requires to exist. */
  | 'unsupported'
  /** The memories it rested on were deleted or forgotten. */
  | 'evidence_withdrawn'
  /** Replaced by a claim that flipped it. */
  | 'superseded';

export const INSIGHT_RETIREMENTS = [
  'expired',
  'unsupported',
  'evidence_withdrawn',
  'superseded',
] as const satisfies readonly InsightRetirement[];

/**
 * Why a candidate pattern did not become an insight.
 *
 * Every one of these is a *good* outcome. The engine is tuned to miss rather
 * than invent, so declines are the common case and a decline nobody can read is
 * a threshold nobody can tune.
 */
export type ReflectionDecline =
  /** Too few distinct memories. */
  | 'insufficient_evidence'
  /** Enough memories, but they restate one another. Repetition is not corroboration. */
  | 'evidence_not_distinct'
  /** Seen too close together to be called a pattern. */
  | 'insufficient_spread'
  /** A generalisation supported by only one underlying thing. */
  | 'insufficient_breadth'
  /** Support and denial are too evenly matched to conclude either. */
  | 'evidence_conflicts'
  /** Scored below the floor its kind requires. */
  | 'below_confidence_floor'
  /** The claim would need wording this engine will not put in the user's mouth. */
  | 'phrasing_not_licensed'
  /** This conclusion has already been drawn and let go, on exactly this evidence. */
  | 'already_concluded'
  /** Sound, but beyond what one pass will form. Will be reconsidered next pass. */
  | 'pass_capacity';

export const REFLECTION_DECLINES = [
  'insufficient_evidence',
  'evidence_not_distinct',
  'insufficient_spread',
  'insufficient_breadth',
  'evidence_conflicts',
  'below_confidence_floor',
  'phrasing_not_licensed',
  'already_concluded',
  'pass_capacity',
] as const satisfies readonly ReflectionDecline[];

/** Why reflection decided as it did. */
export type ReflectionReasonCode =
  | 'evidence_gathered'
  | 'evidence_excluded'
  | 'pattern_clustered'
  | 'breadth_checked'
  | 'spread_checked'
  | 'agreement_measured'
  | 'confidence_scored'
  | 'certainty_banded'
  | 'capped_by_ceiling'
  | 'matches_existing'
  | 'statement_unchanged'
  | 'statement_revised'
  | 'contradiction_found'
  | 'polarity_flipped'
  | 'evidence_withdrawn'
  | 'evidence_stale'
  | 'expiry_reached'
  | 'below_threshold';

export const REFLECTION_REASON_CODES = [
  'evidence_gathered',
  'evidence_excluded',
  'pattern_clustered',
  'breadth_checked',
  'spread_checked',
  'agreement_measured',
  'confidence_scored',
  'certainty_banded',
  'capped_by_ceiling',
  'matches_existing',
  'statement_unchanged',
  'statement_revised',
  'contradiction_found',
  'polarity_flipped',
  'evidence_withdrawn',
  'evidence_stale',
  'expiry_reached',
  'below_threshold',
] as const satisfies readonly ReflectionReasonCode[];

export interface ReflectionReason {
  readonly code: ReflectionReasonCode;
  readonly detail: string;
}

/**
 * What reflection decided about one claim.
 *
 * A discriminated union for the same reason `FormationDecision` is one: a caller
 * must not be able to read `draft` on a decline. The outcomes are kept separate
 * even where two share a payload shape, because each is a distinct thing that
 * happened to the user's model of themselves and each deserves its own event.
 *
 * `reinforce`, `weaken`, `contest` and `revise` all carry an `InsightAdjustment`
 * and all mean different things:
 *
 * - **reinforce** — more of the same evidence; the claim is surer.
 * - **weaken** — the evidence supports it less than it did.
 * - **contest** — evidence has appeared against it, not yet enough to flip it.
 * - **revise** — the same claim, worded differently because certainty moved.
 */
export type InsightDecision =
  | {
      readonly outcome: 'form';
      readonly key: InsightKey;
      readonly draft: InsightDraft;
      readonly reasons: readonly ReflectionReason[];
    }
  | {
      readonly outcome: 'reinforce';
      readonly key: InsightKey;
      readonly targetId: InsightId;
      readonly adjustment: InsightAdjustment;
      readonly reasons: readonly ReflectionReason[];
    }
  | {
      readonly outcome: 'weaken';
      readonly key: InsightKey;
      readonly targetId: InsightId;
      readonly adjustment: InsightAdjustment;
      readonly reasons: readonly ReflectionReason[];
    }
  | {
      readonly outcome: 'contest';
      readonly key: InsightKey;
      readonly targetId: InsightId;
      readonly adjustment: InsightAdjustment;
      readonly reasons: readonly ReflectionReason[];
    }
  | {
      readonly outcome: 'revise';
      readonly key: InsightKey;
      readonly targetId: InsightId;
      readonly adjustment: InsightAdjustment;
      readonly reasons: readonly ReflectionReason[];
    }
  | {
      /** The claim flipped. The old insight is kept readable and marked superseded. */
      readonly outcome: 'replace';
      readonly key: InsightKey;
      readonly targetId: InsightId;
      readonly draft: InsightDraft;
      readonly reasons: readonly ReflectionReason[];
    }
  | {
      readonly outcome: 'retire';
      readonly key: InsightKey;
      readonly targetId: InsightId;
      readonly reason: InsightRetirement;
      readonly change: InsightChange;
      readonly reasons: readonly ReflectionReason[];
    }
  | {
      readonly outcome: 'decline';
      readonly key: InsightKey;
      readonly reason: ReflectionDecline;
      readonly reasons: readonly ReflectionReason[];
    };

/**
 * Everything one reflection pass concluded.
 *
 * `reasons` are about the pass itself — how much evidence was supplied, how much
 * was excluded and why. Per-claim reasoning lives on each decision, so a caller
 * that stores only the decisions still has the whole explanation for each one.
 */
export interface ReflectionResult {
  readonly decisions: readonly InsightDecision[];
  readonly reasons: readonly ReflectionReason[];
}
