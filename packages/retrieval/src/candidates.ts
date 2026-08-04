import type {
  EmbeddingReference,
  Insight,
  Memory,
  RelationshipProfile,
  RetrievalClass,
  Timestamp,
} from '@nexa/models';
import { PERSONALIZATION_RANK } from '@nexa/models';
import { classOfInsight, classOfMemory, insightIsLive } from './classes.js';

/**
 * One thing that *could* become active, flattened into a shape the ranking can
 * measure without knowing what it is.
 *
 * A memory, an insight and a relationship profile have almost nothing in common
 * structurally and are all subject to the same question: does this bear on now?
 * Flattening them once, here, is what lets `signals.ts` and `rank.ts` be free of
 * `if (source === 'memory')` — which matters because every such branch is a
 * place where two kinds of knowledge could drift into being ranked by different
 * rules without anyone deciding they should be.
 *
 * The original object rides along in `payload` and is handed back untouched.
 * Retrieval never creates knowledge; this type is a lens, not a copy.
 */

export type CandidatePayload =
  | { readonly source: 'memory'; readonly memory: Memory }
  | { readonly source: 'insight'; readonly insight: Insight }
  | { readonly source: 'relationship'; readonly relationship: RelationshipProfile };

export interface Candidate {
  readonly id: string;
  readonly payload: CandidatePayload;
  readonly retrievalClass: RetrievalClass;
  /** What is matched against, and what would enter a prompt. */
  readonly text: string;
  /** What recency is measured from. */
  readonly at: Timestamp;
  readonly embedding: EmbeddingReference | null;

  /**
   * Quantities that are genuinely absent on some sources.
   *
   * Null rather than a neutral number, because the two are not the same and the
   * difference decides the score. An insight has no importance — memory
   * formation scores that and reflection does not — so treating it as 0.5 would
   * invent a measurement, and treating it as 0 would penalise every insight for
   * a field it was never meant to have. Null means "not measurable here", and
   * scoring skips the dimension entirely.
   */
  readonly importance: number | null;
  readonly confidence: number | null;
  readonly stability: number | null;
  readonly reinforcement: number | null;

  /**
   * Memory ids this rests on. Non-empty only for insights.
   *
   * The subsumption signal: if the companion is going to say "you seem to prefer
   * short answers", the three memories that conclusion was drawn from are not
   * three more things worth carrying. They are the working.
   */
  readonly evidence: readonly string[];
}

/**
 * How many re-observations count as fully reinforced.
 *
 * Five, and flat above it. The difference between something said once and said
 * five times is most of the information; the difference between five and fifty
 * is a user with a habit of repeating themselves, and letting that keep
 * accumulating turns emphasis into rank.
 */
export const REINFORCEMENT_SATURATION = 5;

/** How many pieces of supporting evidence count as fully corroborated, for an insight. */
export const EVIDENCE_SATURATION = 6;

/** How many recorded collaborations count as a fully exercised relationship. */
export const COLLABORATION_SATURATION = 50;

export const candidateOfMemory = (memory: Memory): Candidate => ({
  id: memory.id,
  payload: { source: 'memory', memory },
  retrievalClass: classOfMemory(memory),
  text: memory.content,
  // Last reinforcement rather than creation, for the same reason memory's own
  // decay measures from there: a memory re-observed last week is not a
  // three-year-old memory, and ranking it as one makes reinforcement decorative.
  at: memory.lastReinforcedAt ?? memory.createdAt,
  embedding: memory.embedding,
  importance: memory.importance,
  confidence: memory.confidence,
  stability: null,
  reinforcement: Math.min(1, memory.reinforcementCount / REINFORCEMENT_SATURATION),
  evidence: [],
});

export const candidateOfInsight = (insight: Insight): Candidate => ({
  id: insight.id,
  payload: { source: 'insight', insight },
  retrievalClass: classOfInsight(insight.kind),
  text: insight.statement,
  at: insight.lastSupportedAt,
  // Insights are not embedded: the vector store holds memories. Semantic scoring
  // therefore never applies to them, and `null` is how that is said rather than
  // implied by a lookup that quietly misses.
  embedding: null,
  importance: null,
  confidence: insight.confidence,
  stability: insight.stability,
  reinforcement: Math.min(1, insight.supporting.length / EVIDENCE_SATURATION),
  evidence: insight.supporting.map((entry) => entry.memoryId),
});

/**
 * The relationship as a candidate.
 *
 * Its `text` is a compact factual line rather than prose — the same register as
 * an insight's statement, and for the same reason: retrieval must not write
 * anything that reads as the companion speaking. It exists so the item can be
 * costed against the token budget and so a caller without its own relationship
 * section has something to carry. Generation is free to render its own from the
 * profile, which travels intact in the payload.
 */
export const candidateOfRelationship = (
  profile: RelationshipProfile,
  at: Timestamp,
): Candidate => ({
  id: `relationship:${profile.stage}`,
  payload: { source: 'relationship', relationship: profile },
  retrievalClass: 'relationship',
  text: `Relationship stage: ${profile.stage}; personalisation: ${profile.personalization}; contact: ${profile.cadence}; initiative: ${profile.initiative}.`,
  at,
  embedding: null,
  importance: null,
  // The profile is derived, not believed — it is a reading of a record rather
  // than a claim that might be wrong, so it has no confidence to report.
  confidence: null,
  stability: null,
  // Requests and plans only. Corrections and acknowledged uncertainties are
  // counted too, and neither is a *collaboration* — one is the companion being
  // wrong and the other is it admitting a limit. Both belong to how trust was
  // earned, which `sharedUnderstanding` already reflects; adding them here would
  // make a relationship look more exercised the more often it went wrong.
  reinforcement: Math.min(
    1,
    (profile.collaboration.requestsHandled + profile.collaboration.plansSupported) /
      COLLABORATION_SATURATION,
  ),
  evidence: [],
});

/** How much the relationship licenses drawing on shared history at all. */
export const relationshipFit = (profile: RelationshipProfile | null): number | null => {
  if (profile === null) return null;
  // Shared understanding tempered by how far personalisation has been earned.
  // Either alone misreads: a long relationship the user keeps at arm's length
  // has high familiarity and low licence, and a warm one three days old has the
  // reverse.
  const licence = PERSONALIZATION_RANK[profile.personalization] / 3;
  return Math.min(1, (profile.sharedUnderstanding + licence) / 2);
};

/** Why a candidate never reached the ranking. */
export type IneligibleReason =
  | 'expired'
  | 'below_confidence'
  | 'not_live'
  | 'empty'
  | 'from_the_future';

/**
 * Whether a memory may be considered at all.
 *
 * `from_the_future` is the replay guard: a retrieval replayed as of March must
 * not see April's memories, or a reconstructed turn would carry context the
 * companion did not have when it answered.
 */
export const memoryEligibility = (
  memory: Memory,
  at: Timestamp,
  minConfidence: number,
): IneligibleReason | null => {
  if (memory.content.trim().length === 0) return 'empty';
  if (Date.parse(memory.createdAt) > Date.parse(at)) return 'from_the_future';
  if (memory.expiresAt !== null && Date.parse(at) >= Date.parse(memory.expiresAt)) {
    return 'expired';
  }
  if (memory.confidence < minConfidence) return 'below_confidence';
  return null;
};

/**
 * Whether an insight may be considered at all.
 *
 * Retired and superseded insights are never surfaced. They are kept readable so
 * "you used to think I preferred tea" is answerable, which is a question about
 * history — and answering it is a different act from quietly acting on a
 * conclusion the companion has already let go.
 */
export const insightEligibility = (
  insight: Insight,
  at: Timestamp,
  minConfidence: number,
): IneligibleReason | null => {
  if (!insightIsLive(insight)) return 'not_live';
  if (Date.parse(insight.createdAt) > Date.parse(at)) return 'from_the_future';
  if (insight.expiresAt !== null && Date.parse(at) >= Date.parse(insight.expiresAt)) {
    return 'expired';
  }
  if (insight.confidence < minConfidence) return 'below_confidence';
  return null;
};
