import type { RelevanceSignals, SignalName, Timestamp } from '@nexa/models';
import type { Candidate } from './candidates.js';
import { relationshipFit } from './candidates.js';
import type { ClassPolicy } from './classes.js';
import { NO_SIGNALS } from './classes.js';
import type { RetrievalQuery } from './query.js';
import { EMOTIONALLY_RELEVANT_CLASSES, isSupportive } from './query.js';
import type { SemanticIndex } from './semantic.js';
import { similarityOf } from './semantic.js';
import { coverage, mentions, round } from './text.js';

/**
 * Measuring one candidate against the moment, on every dimension that applies.
 *
 * ## Measured, not merely scored
 *
 * Each signal reports whether it could be measured at all, separately from what
 * it measured. The distinction is the load-bearing one in this file, and it is
 * usually got wrong: a memory with no embedding scores zero on semantic, and a
 * naive weighted sum then *penalises* it — for the failure of a background
 * embedding job, not for anything about its relevance. Over a store mid-way
 * through a re-embed, that quietly reorders everything.
 *
 * So an unmeasurable dimension is excluded from the average rather than scored
 * zero, and which dimensions were available travels onto the item. "Ranked on
 * eight of twelve dimensions" is a fact a caller can act on; a silently
 * depressed score is not.
 */

export interface SignalReading {
  readonly signals: RelevanceSignals;
  /** Dimensions that could be measured for this candidate. Never empty. */
  readonly measured: readonly SignalName[];
  /** Set when semantic scoring was attempted and could not be done. */
  readonly semanticMiss: string | null;
}

/**
 * How much a bare entity mention is worth.
 *
 * A floor rather than a ratio. If the message names three things and a memory is
 * about one of them, that memory is squarely on topic — scoring it 0.33 would
 * rank it below a candidate that vaguely echoes the phrasing of all three, which
 * inverts what "the user just named this" means. The remainder scales with how
 * many were matched, so covering all three still beats covering one.
 */
export const ENTITY_FLOOR = 0.6;

/**
 * The most an emotional read alone can be worth.
 *
 * Below a solid lexical match on purpose. "I'm feeling frustrated" should reach
 * the overworking reflection and the communication preference — and it must
 * never let the companion's read of someone's mood outrank something the user
 * actually said. Capping the anchor keeps the emotional route a way in rather
 * than a way to the top.
 */
export const EMOTIONAL_ANCHOR_CEILING = 0.7;

/** How sure perception must be before the emotional anchor opens at all. */
export const EMOTIONAL_ANCHOR_FLOOR = 0.35;

export const measure = (
  candidate: Candidate,
  query: RetrievalQuery,
  policy: ClassPolicy,
  index: SemanticIndex | null,
): SignalReading => {
  const signals: Record<SignalName, number> = { ...NO_SIGNALS };
  const measured: SignalName[] = [];

  const take = (name: SignalName, value: number): void => {
    signals[name] = round(Math.min(1, Math.max(0, value)));
    measured.push(name);
  };

  // ── anchors ────────────────────────────────────────────────────────────
  const semantic = similarityOf(index, candidate.embedding);
  if (semantic.miss === null) take('semantic', semantic.similarity);

  if (query.messageTerms.length > 0) {
    take('lexical', coverage(query.messageTerms, candidate.text));
  }

  if (query.entities.length > 0) {
    const matched = mentions(candidate.text, query.entities);
    take(
      'entity',
      matched.length === 0
        ? 0
        : ENTITY_FLOOR + (1 - ENTITY_FLOOR) * (matched.length / query.entities.length),
    );
  }

  if (query.goalTermSets.length > 0) {
    // The best single goal, not the average. A memory that squarely serves one
    // of six goals is relevant; averaging would report it as a sixth as relevant
    // as it is, and the more goals a user has the less any of them would count.
    let best = 0;
    for (const goal of query.goalTermSets) {
      const served = coverage(goal.terms, candidate.text) * (0.6 + 0.4 * goal.priority);
      if (served > best) best = served;
    }
    take('goal_relevance', best);
  }

  if (query.topicTerms.length > 0) {
    take('topic_continuity', coverage(query.topicTerms, candidate.text));
  }

  if (isSupportive(query, EMOTIONAL_ANCHOR_FLOOR)) {
    take(
      'emotional_fit',
      EMOTIONALLY_RELEVANT_CLASSES.includes(candidate.retrievalClass)
        ? EMOTIONAL_ANCHOR_CEILING * query.emotionalIntensity
        : 0,
    );
  }

  // ── qualifiers ─────────────────────────────────────────────────────────
  take('recency', decay(candidate.at, query.at, policy.halfLifeDays));

  if (candidate.reinforcement !== null) take('reinforcement', candidate.reinforcement);
  if (candidate.importance !== null) take('importance', candidate.importance);
  if (candidate.confidence !== null) take('confidence', candidate.confidence);
  if (candidate.stability !== null) take('stability', candidate.stability);

  const fit = relationshipFit(query.relationship);
  if (fit !== null) take('relationship_fit', fit);

  return { signals, measured, semanticMiss: semantic.miss };
};

/**
 * Recency as exponential decay against the class's own half-life.
 *
 * Exponential rather than linear so nothing ever reaches zero. A linear ramp to
 * zero makes anything past the horizon *unreachable* — a ten-year-old milestone
 * would score nothing on recency and, with enough weight there, could not
 * surface even when the user asked about it directly. Halving forever keeps old
 * things ranked below new ones without putting them out of reach, which is the
 * behaviour a companion meant to remember years needs.
 *
 * Total over a malformed instant: an unparseable timestamp costs the candidate
 * its recency, not the whole retrieval.
 */
export const decay = (from: Timestamp, to: Timestamp, halfLifeDays: number): number => {
  const start = Date.parse(from);
  const now = Date.parse(to);
  if (!Number.isFinite(start) || !Number.isFinite(now) || halfLifeDays <= 0) return 0;

  const ageDays = Math.max(0, (now - start) / 86_400_000);
  return round(Math.pow(2, -ageDays / halfLifeDays));
};
