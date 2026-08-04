import type { RelevanceSignals, RetrievalReason, SignalName } from '@nexa/models';
import { ANCHOR_SIGNALS } from '@nexa/models';
import type { Candidate } from './candidates.js';
import type { ClassPolicy } from './classes.js';
import type { SignalReading } from './signals.js';
import { round } from './text.js';

/**
 * Turning twelve measurements into one order, without turning them into one
 * number nobody can argue with.
 *
 * Three separate things happen here and they must not be confused:
 *
 * 1. **The gate** decides whether a candidate is about *now*. Only anchoring
 *    signals count. This is not part of the score.
 * 2. **The score** decides how strongly, as an applicability-normalised weighted
 *    mean over every dimension that could be measured.
 * 3. **The order** is the score with a deterministic tiebreak chain, so two
 *    identical requests produce byte-identical output.
 *
 * Keeping the gate out of the score is the single most consequential decision in
 * the engine. Fold them together and a memory with no relevance at all but
 * enormous importance climbs past a modest one that is exactly on topic, because
 * a weighted sum has no way to express "this must be about the question".
 */

/**
 * A candidate measured, gated and scored, before deduplication and budgeting.
 */
export interface Ranked {
  readonly candidate: Candidate;
  readonly signals: RelevanceSignals;
  readonly measured: readonly SignalName[];
  readonly anchor: SignalName;
  readonly anchorStrength: number;
  readonly admitted: boolean;
  readonly score: number;
  readonly reasons: readonly RetrievalReason[];
}

/**
 * Below this many measurable dimensions, the score is discounted.
 *
 * The one guard the applicability normalisation needs. Normalising by what could
 * be measured is right, and taken alone it lets a candidate scored on two
 * dimensions reach 1.0 as easily as one scored on ten reaches 0.8 — high
 * confidence resting on very little. Scaling by how much of the picture was
 * available keeps the normalisation honest without reintroducing the penalty it
 * exists to remove.
 */
export const MIN_MEASURED_SIGNALS = 4;

/** The strongest anchoring signal, and how strong. Ties break in declared order. */
export const anchorOf = (
  signals: RelevanceSignals,
): { readonly name: SignalName; readonly strength: number } => {
  let name: SignalName = ANCHOR_SIGNALS[0];
  let strength = signals[ANCHOR_SIGNALS[0]];

  for (const candidateName of ANCHOR_SIGNALS) {
    if (signals[candidateName] > strength) {
      name = candidateName;
      strength = signals[candidateName];
    }
  }

  return { name, strength };
};

/**
 * The weighted mean over measurable dimensions.
 *
 * Normalised by the weight actually available rather than by the full weight of
 * the class profile. A memory that has not been embedded is not a worse memory,
 * and an insight has no importance to report — neither should lose score for a
 * dimension that was never applicable to it. Without this, ranking silently
 * prefers whichever kind of knowledge happens to fill in the most fields.
 */
export const scoreOf = (reading: SignalReading, policy: ClassPolicy): number => {
  const measurable = new Set(reading.measured);
  let weighted = 0;
  let available = 0;

  for (const [name, weight] of Object.entries(policy.weights) as [SignalName, number][]) {
    if (!measurable.has(name)) continue;
    weighted += weight * reading.signals[name];
    available += weight;
  }

  if (available === 0) return 0;

  const mean = weighted / available;
  const breadth = Math.min(1, reading.measured.length / MIN_MEASURED_SIGNALS);
  return round(mean * breadth);
};

export interface RankInputs {
  readonly candidate: Candidate;
  readonly reading: SignalReading;
  readonly policy: ClassPolicy;
  readonly relevanceFloor: number;
}

export const rank = (inputs: RankInputs): Ranked => {
  const { candidate, reading, policy, relevanceFloor } = inputs;
  const anchor = anchorOf(reading.signals);
  const admitted = anchor.strength >= relevanceFloor;
  const score = admitted ? scoreOf(reading, policy) : 0;

  return {
    candidate,
    signals: reading.signals,
    measured: reading.measured,
    anchor: anchor.name,
    anchorStrength: anchor.strength,
    admitted,
    score,
    reasons: admitted ? explain(anchor.name, anchor.strength, reading, score) : [],
  };
};

/** Why this item is here, and why this high. */
const explain = (
  anchor: SignalName,
  strength: number,
  reading: SignalReading,
  score: number,
): readonly RetrievalReason[] => {
  const reasons: RetrievalReason[] = [
    {
      code: ANCHOR_REASONS[anchor],
      detail: `Anchored on ${anchor} at ${strength.toFixed(2)}.`,
    },
    {
      code: 'scored',
      detail: `Scored ${score.toFixed(2)} across ${reading.measured.length} measurable dimensions: ${reading.measured.join(', ')}.`,
    },
  ];

  if (reading.semanticMiss !== null) {
    reasons.push({
      code: 'semantic_unavailable',
      detail: `No semantic comparison for this candidate (${reading.semanticMiss}); ranked on the rest.`,
    });
  }

  // Qualifiers are reported only when they are strong enough to have moved the
  // result. Listing all six every time turns the explanation into a data dump,
  // and an explanation nobody reads is one that may as well not exist.
  for (const [name, code, threshold] of QUALIFIER_REASONS) {
    if (reading.signals[name] >= threshold) {
      reasons.push({
        code,
        detail: `${name} at ${reading.signals[name].toFixed(2)}.`,
      });
    }
  }

  return reasons;
};

const ANCHOR_REASONS: Readonly<Record<SignalName, RetrievalReason['code']>> = {
  semantic: 'anchored_semantically',
  lexical: 'anchored_lexically',
  entity: 'entity_mentioned',
  goal_relevance: 'serves_goal',
  topic_continuity: 'continues_topic',
  emotional_fit: 'matches_emotion',
  // Never an anchor; present so the map is total and a future signal promoted to
  // anchor status cannot silently fall through to a wrong code.
  recency: 'recent',
  reinforcement: 'reinforced',
  importance: 'high_importance',
  confidence: 'well_evidenced',
  stability: 'stable',
  relationship_fit: 'relationship_relevant',
};

const QUALIFIER_REASONS: readonly (readonly [
  SignalName,
  RetrievalReason['code'],
  number,
])[] = [
  ['recency', 'recent', 0.7],
  ['reinforcement', 'reinforced', 0.6],
  ['importance', 'high_importance', 0.7],
  ['confidence', 'well_evidenced', 0.75],
  ['stability', 'stable', 0.6],
  ['relationship_fit', 'relationship_relevant', 0.6],
];

/**
 * The total order.
 *
 * Score first, then a chain that cannot tie: anchor strength, then recency of
 * the underlying thing, then id. The last is arbitrary and that is exactly why
 * it is there — without a final arbitrary-but-fixed key, two candidates equal on
 * everything else would come back in whatever order the caller's store happened
 * to return them, and the engine's replay guarantee would hold everywhere except
 * where it was tested least.
 */
export const byRank = (a: Ranked, b: Ranked): number =>
  b.score - a.score ||
  b.anchorStrength - a.anchorStrength ||
  b.candidate.at.localeCompare(a.candidate.at) ||
  a.candidate.id.localeCompare(b.candidate.id);
