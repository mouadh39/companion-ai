import type {
  ConversationTurn,
  Degradation,
  ExcludedCandidate,
  ExpressionProfile,
  Goal,
  IdentityProfile,
  Insight,
  Memory,
  PerceptionOutcome,
  RelationshipProfile,
  RetrievalBudget,
  RetrievalItem,
  RetrievalOutcome,
  RetrievalReason,
  Timestamp,
} from '@nexa/models';
import type { Candidate, IneligibleReason } from './candidates.js';
import {
  candidateOfInsight,
  candidateOfMemory,
  candidateOfRelationship,
  insightEligibility,
  memoryEligibility,
} from './candidates.js';
import { defaultBudget, fit } from './budget.js';
import type { RetrievalConfig } from './config.js';
import { DEFAULT_CONFIG } from './config.js';
import { dedupe } from './dedupe.js';
import { deriveQuery } from './query.js';
import type { Ranked } from './rank.js';
import { byRank, rank } from './rank.js';
import type { SemanticIndex } from './semantic.js';
import { measure } from './signals.js';

/**
 * One retrieval: everything the companion knows in, what matters now out.
 *
 * Pure, total, clock-free, model-free and store-free. Identical input produces
 * byte-identical output, which is what lets a turn's context be reconstructed
 * from its log — and what makes "why did you bring that up?" answerable a year
 * later rather than only while the process that decided it is still running.
 *
 * ## This is the second of two stages
 *
 * Over years of history nothing pure can look at everything, and this engine
 * does not try. Candidate *generation* — vector search, recency window, subject
 * filter — belongs to the store, which has indexes and can afford I/O. This is
 * candidate *selection*: given a few hundred plausible things, decide which
 * dozen matter and be able to defend it. `candidatesTruncated` is how the first
 * stage tells the second that it cut the list short, and it becomes a recorded
 * degradation rather than an invisible one.
 *
 * The engine therefore scales by *not growing*: its cost is a function of the
 * candidate set the caller chose, not of how long the companion has known
 * someone.
 *
 * ## The order of the pass
 *
 * 1. **Eligibility** — expired, retired, unsure, or from the future.
 * 2. **Query** — the turn distilled once, so every candidate is measured against
 *    the same thing.
 * 3. **Measure** — twelve dimensions, each recording whether it applied.
 * 4. **Gate** — an anchoring signal must clear the floor. Importance is a
 *    tiebreaker, never a ticket.
 * 5. **Rank** — applicability-normalised weighted mean, plus a tiebreak chain
 *    that cannot tie.
 * 6. **Dedupe** — same object, same claim, or evidence an insight already speaks
 *    for.
 * 7. **Fit** — reserved slots, then open competition, under three ceilings.
 */

export interface RetrievalRequest {
  /** The instant this retrieval is made against. Never read from a clock. */
  readonly at: Timestamp;
  /**
   * What perception noticed, in full.
   *
   * The rich outcome rather than the narrowed `Perception` Core consumes.
   * Retrieval is a sibling of perception, not a consumer of Core's projection of
   * it — reading the projection meant the observed/possible distinction was
   * flattened before it arrived.
   */
  readonly perception: PerceptionOutcome;
  /**
   * The message as written.
   *
   * Supplied alongside the outcome because `PerceptionOutcome` deliberately
   * holds observations and not the utterance. Lexical matching needs the words.
   */
  readonly message: string;
  /** Recent exchanges, for topic continuity. Oldest first. */
  readonly conversation: readonly ConversationTurn[];

  /**
   * Candidate memories and insights, supplied by the caller.
   *
   * Retrieval performs no queries. Choosing what to remember, what it means, and
   * where to find it are three different problems, and fusing the third into
   * this engine would make it impossible to test without a store and impossible
   * to reason about when the store is slow.
   */
  readonly memories: readonly Memory[];
  readonly insights: readonly Insight[];

  readonly goals: readonly Goal[];
  readonly relationship: RelationshipProfile | null;

  /**
   * How the companion intends to communicate this turn.
   *
   * Used for exactly one thing: shrinking the item budget when the turn is meant
   * to be brief. A companion about to answer in one line has no use for twelve
   * memories, and assembling them spends tokens and latency on context that
   * cannot appear in the reply.
   */
  readonly expression?: ExpressionProfile | null;

  /**
   * Nexa's own identity, for boundary annotation.
   *
   * Used to *flag*, never to filter. If the companion defers on medical
   * subjects, a memory the user told it about their health is still their
   * memory and still relevant when they raise it — suppressing it would be
   * amnesia with a policy attached. What retrieval does is mark the item so
   * generation applies the identity's stance knowingly.
   */
  readonly identity?: IdentityProfile | null;

  /** Query and candidate vectors. Absent means ranking without its best signal. */
  readonly semantic?: SemanticIndex | null;

  /** The caller cut its candidate list short. Recorded as a degradation. */
  readonly candidatesTruncated?: boolean;

  readonly budget?: RetrievalBudget;
  readonly config?: RetrievalConfig;
}

export const retrieve = (request: RetrievalRequest): RetrievalOutcome => {
  const config = request.config ?? DEFAULT_CONFIG;
  const index = request.semantic ?? null;
  const budget = scaledBudget(request.budget ?? defaultBudget(), request.expression ?? null, config);

  const reasons: RetrievalReason[] = [];
  const degraded: Degradation[] = [];
  const ineligible: ExcludedCandidate[] = [];

  // ── 1. eligibility ─────────────────────────────────────────────────────
  const candidates: Candidate[] = [];

  for (const memory of request.memories) {
    const reason = memoryEligibility(memory, request.at, config.minConfidence);
    if (reason === null) candidates.push(candidateOfMemory(memory));
    else ineligible.push(notEligible(candidateOfMemory(memory), reason));
  }

  for (const insight of request.insights) {
    const reason = insightEligibility(insight, request.at, config.minConfidence);
    if (reason === null) candidates.push(candidateOfInsight(insight));
    else ineligible.push(notEligible(candidateOfInsight(insight), reason));
  }

  if (request.relationship !== null) {
    candidates.push(candidateOfRelationship(request.relationship, request.at));
  }

  reasons.push({
    code: 'scored',
    detail: `${candidates.length} of ${request.memories.length + request.insights.length} supplied items were eligible.`,
  });

  // ── 2. the query, distilled once ───────────────────────────────────────
  const query = deriveQuery({
    at: request.at,
    perception: request.perception,
    message: request.message,
    conversation: request.conversation,
    goals: request.goals,
    relationship: request.relationship,
  });

  // ── 3 & 4 & 5. measure, gate, rank ─────────────────────────────────────
  const measured: Ranked[] = [];
  const rejected: ExcludedCandidate[] = [];
  let incomparable = 0;

  for (const candidate of candidates) {
    const policy = config.classes[candidate.retrievalClass];
    const reading = measure(candidate, query, policy, index);
    if (reading.semanticMiss === 'incomparable') incomparable++;

    const entry = rank({
      candidate,
      reading,
      policy,
      relevanceFloor: config.relevanceFloor,
    });

    if (entry.admitted) measured.push(entry);
    else
      rejected.push({
        id: candidate.id,
        source: candidate.payload.source,
        retrievalClass: candidate.retrievalClass,
        reason: 'below_relevance_floor',
        detail: `Strongest anchor was ${entry.anchor} at ${entry.anchorStrength.toFixed(2)}, under the ${config.relevanceFloor.toFixed(2)} floor.`,
        bestSignal: entry.anchor,
        bestSignalStrength: entry.anchorStrength,
      });
  }

  const ordered = [...measured].sort(byRank);

  // ── 6. dedupe ──────────────────────────────────────────────────────────
  const deduped = dedupe(ordered, config.duplicateThreshold);

  // ── 7. fit ─────────────────────────────────────────────────────────────
  const fitted = fit(deduped.kept, budget, config.estimate);

  // ── degradations ───────────────────────────────────────────────────────
  if (index === null) {
    degraded.push({
      reason: 'semantic_unavailable',
      detail: 'No vectors supplied; ranked on lexical, entity, goal and topic signals.',
    });
  }
  if (incomparable > 0) {
    degraded.push({
      reason: 'embeddings_incomparable',
      detail: `${incomparable} candidate(s) were embedded by a different model and could not be compared.`,
    });
  }
  if (request.candidatesTruncated === true) {
    degraded.push({
      reason: 'candidates_truncated',
      detail: 'The caller cut its candidate list short; there may be better matches it did not supply.',
    });
  }
  if (request.goals.length === 0) {
    degraded.push({
      reason: 'goals_unavailable',
      detail: 'No active goals supplied; goal relevance did not contribute.',
    });
  }
  if (request.relationship === null) {
    degraded.push({
      reason: 'relationship_unavailable',
      detail: 'No relationship profile supplied; relationship fit did not contribute.',
    });
  }
  if (fitted.boundByItems) {
    degraded.push({
      reason: 'budget_items',
      detail: `The ${budget.maxItems}-item budget bound the result.`,
    });
  }
  if (fitted.boundByTokens) {
    degraded.push({
      reason: 'budget_tokens',
      detail: `The ${budget.maxTokens}-token budget bound the result.`,
    });
  }

  // Ordered so the most informative exclusions survive truncation: things that
  // were relevant and lost come before things that were never relevant at all.
  const excluded = [...fitted.excluded, ...deduped.removed, ...rejected, ...ineligible];

  const boundaries = boundaryIndex(request.identity ?? null);
  const items = fitted.kept.map((entry, position) =>
    toItem(entry, position + 1, boundaries, config),
  );

  return {
    items,
    excluded: excluded.slice(0, config.maxExplanations),
    consideredCount: candidates.length + ineligible.length,
    excludedCount: excluded.length,
    spend: fitted.spend,
    degraded,
    reasons,
    at: request.at,
  };
};

/**
 * Shrinks the item budget when the turn is meant to be brief.
 *
 * Only ever downward, and only the item count. Letting an expression profile
 * *raise* a ceiling would let a personality setting spend the caller's token
 * budget, and letting it move the token ceiling would make the same context cost
 * different amounts depending on the companion's mood.
 */
const scaledBudget = (
  budget: RetrievalBudget,
  expression: ExpressionProfile | null,
  config: RetrievalConfig,
): RetrievalBudget => {
  if (expression === null) return budget;

  const scale = config.detailScaling[expression.detail];
  if (scale >= 1) return budget;

  return {
    ...budget,
    // At least one: a terse companion still gets the single most relevant thing.
    // Scaling to zero would make brevity indistinguishable from amnesia.
    maxItems: Math.max(1, Math.floor(budget.maxItems * scale)),
  };
};

/** Boundary domains, as term sets, so a memory can be matched against them. */
const boundaryIndex = (
  identity: IdentityProfile | null,
): readonly { readonly id: string; readonly domain: string }[] =>
  identity === null
    ? []
    : identity.knowledgeBoundaries
        .filter((boundary) => boundary.stance !== 'answers_with_caveat')
        .map((boundary) => ({ id: boundary.id, domain: boundary.domain }));

const toItem = (
  entry: Ranked,
  rankPosition: number,
  boundaries: readonly { readonly id: string; readonly domain: string }[],
  config: RetrievalConfig,
): RetrievalItem => {
  const { candidate } = entry;
  const policy = config.classes[candidate.retrievalClass];
  const touched = boundaries
    .filter((boundary) => touchesDomain(candidate.text, boundary.domain))
    .map((boundary) => boundary.id);

  const reasons: RetrievalReason[] = [...entry.reasons];
  if (touched.length > 0) {
    reasons.push({
      code: 'boundary_flagged',
      detail: `Touches identity boundary ${touched.join(', ')}; surfaced, not suppressed.`,
    });
  }

  const base = {
    rank: rankPosition,
    retrievalClass: candidate.retrievalClass,
    durability: policy.durability,
    score: entry.score,
    signals: entry.signals,
    anchor: entry.anchor,
    anchorStrength: entry.anchorStrength,
    reasons,
    boundaries: touched,
    text: candidate.text,
    estimatedTokens: config.estimate(candidate.text),
  } as const;

  switch (candidate.payload.source) {
    case 'memory':
      return { ...base, source: 'memory', memory: candidate.payload.memory };
    case 'insight':
      return { ...base, source: 'insight', insight: candidate.payload.insight };
    case 'relationship':
      return {
        ...base,
        source: 'relationship',
        relationship: candidate.payload.relationship,
      };
  }
};

/**
 * Whether a text is about a boundary domain.
 *
 * A word match, and deliberately a crude one — it produces a *flag* that
 * generation consults, not a decision. Over-flagging costs a downstream
 * consideration nobody has to act on; under-flagging costs a companion talking
 * past its own stated limits without noticing.
 */
const touchesDomain = (text: string, domain: string): boolean => {
  const haystack = ` ${text.toLowerCase()} `;
  return domain
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 3)
    .some((word) => haystack.includes(word));
};

const notEligible = (candidate: Candidate, reason: IneligibleReason): ExcludedCandidate => ({
  id: candidate.id,
  source: candidate.payload.source,
  retrievalClass: candidate.retrievalClass,
  reason: 'not_eligible',
  detail: INELIGIBLE_DETAIL[reason],
  bestSignal: 'lexical',
  bestSignalStrength: 0,
});

const INELIGIBLE_DETAIL: Readonly<Record<IneligibleReason, string>> = {
  expired: 'Past its expiry; it is no longer current.',
  below_confidence: 'Under the confidence a candidate needs to be worth surfacing.',
  not_live: 'Retired or superseded. Readable as history, never acted on.',
  empty: 'No content to retrieve.',
  from_the_future:
    'Created after the instant this retrieval was made against; excluded so a replay cannot see ahead.',
};
