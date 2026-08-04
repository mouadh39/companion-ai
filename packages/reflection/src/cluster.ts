import type { InsightKey, InsightKind, Timestamp } from '@nexa/models';
import { insightKey } from '@nexa/models';
import type { ReflectionConfig } from './config.js';
import type { Observation } from './observe.js';
import { similarity } from './text.js';

/**
 * Grouping observations into the claims they could support.
 *
 * A cluster is every observation that points at the same `kind:topicKey`, split
 * by which way it points. Nothing here decides anything — it counts, dates and
 * de-duplicates, and hands the result to the gates. Keeping the counting apart
 * from the judging is what lets the formation rules in `reflect.ts` be read as a
 * list of conditions rather than as a traversal.
 */

export interface Cluster {
  readonly key: InsightKey;
  readonly kind: InsightKind;
  readonly topicKey: string;
  /** The readable topic. Lexicographically smallest surface form, for stability. */
  readonly topic: string;
  readonly viaTheme: boolean;
  /** Distinct memories affirming, one entry per memory. */
  readonly affirming: readonly Observation[];
  /** Distinct memories denying, one entry per memory. */
  readonly denying: readonly Observation[];
  /** How many observations were dropped as restatements of one already counted. */
  readonly duplicatesDropped: number;
  /** Distinct source tokens behind the affirming evidence. The breadth signal. */
  readonly affirmingBreadth: number;
  readonly denyingBreadth: number;
}

/**
 * How many days an evidence set spans.
 *
 * Total over a malformed timestamp: a corrupt date should cost a pattern its
 * spread, not throw inside a background pass that has ninety other patterns to
 * get through.
 */
export const spanDaysOf = (observations: readonly { readonly at: Timestamp }[]): number => {
  if (observations.length === 0) return 0;

  let earliest = Number.POSITIVE_INFINITY;
  let latest = Number.NEGATIVE_INFINITY;

  for (const observation of observations) {
    const parsed = Date.parse(observation.at);
    if (!Number.isFinite(parsed)) continue;
    if (parsed < earliest) earliest = parsed;
    if (parsed > latest) latest = parsed;
  }

  if (!Number.isFinite(earliest) || !Number.isFinite(latest)) return 0;
  return Math.max(0, (latest - earliest) / 86_400_000);
};

/**
 * Sorts observations into a fixed order before anything reads them.
 *
 * Deduplication keeps whichever it sees first, so without a total order the
 * evidence an insight cites would depend on the order the caller happened to
 * fetch memories in — and two replays of one history would produce two different
 * stores. Chronological, then by id, then by token: no two observations tie.
 */
const ordered = (observations: readonly Observation[]): readonly Observation[] =>
  [...observations].sort(
    (a, b) =>
      a.at.localeCompare(b.at) ||
      a.memoryId.localeCompare(b.memoryId) ||
      a.sourceToken.localeCompare(b.sourceToken),
  );

/**
 * One memory counts once, and one remark counts once.
 *
 * Two collapses, and they are different:
 *
 * - **By memory** — a memory that touches a theme through two words is one piece
 *   of evidence, not two. Its second token still counts toward *breadth*, which
 *   is why the token is banked before the observation is dropped.
 * - **By wording** — two memories that restate each other are one remark said
 *   twice. Repetition is not corroboration, and counting it as such is how "I
 *   really do prefer tea" becomes a settled belief on the strength of one
 *   opinion held emphatically.
 */
const distinct = (
  observations: readonly Observation[],
  config: ReflectionConfig,
): { kept: readonly Observation[]; dropped: number; breadth: number } => {
  const kept: Observation[] = [];
  const memories = new Set<string>();
  const tokens = new Set<string>();
  let dropped = 0;

  for (const observation of ordered(observations)) {
    if (memories.has(observation.memoryId)) {
      tokens.add(observation.sourceToken);
      continue;
    }

    const restates = kept.some(
      (existing) => similarity(existing.text, observation.text) >= config.duplicateThreshold,
    );
    if (restates) {
      dropped++;
      continue;
    }

    memories.add(observation.memoryId);
    tokens.add(observation.sourceToken);
    kept.push(observation);
  }

  return { kept, dropped, breadth: tokens.size };
};

/**
 * Every claim the supplied observations could bear on.
 *
 * Returned in key order, so a pass emits its decisions in an order that depends
 * only on what it concluded — never on the order the evidence arrived in.
 */
export const cluster = (
  observations: readonly Observation[],
  config: ReflectionConfig,
): readonly Cluster[] => {
  const groups = new Map<string, Observation[]>();

  for (const observation of observations) {
    const key = `${observation.kind}|${observation.topicKey}`;
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [observation]);
    else group.push(observation);
  }

  const clusters: Cluster[] = [];

  for (const group of groups.values()) {
    const first = group[0];
    if (first === undefined) continue;

    const affirming = distinct(
      group.filter((observation) => observation.polarity === 'affirms'),
      config,
    );
    const denying = distinct(
      group.filter((observation) => observation.polarity === 'denies'),
      config,
    );

    // Smallest surface form rather than the first seen: a label that shifted as
    // evidence accumulated would rewrite the statement and log a revision that
    // reflects nothing about the user.
    const topic = first.viaTheme
      ? first.topic
      : group.map((observation) => observation.topic).sort()[0] ?? first.topic;

    clusters.push({
      key: insightKey(first.kind, first.topicKey),
      kind: first.kind,
      topicKey: first.topicKey,
      topic,
      viaTheme: first.viaTheme,
      affirming: affirming.kept,
      denying: denying.kept,
      duplicatesDropped: affirming.dropped + denying.dropped,
      affirmingBreadth: affirming.breadth,
      denyingBreadth: denying.breadth,
    });
  }

  return clusters.sort((a, b) => a.key.localeCompare(b.key));
};
