import type {
  Insight,
  InsightChange,
  InsightDecision,
  InsightDraft,
  InsightAdjustment,
  Timestamp,
} from '@nexa/models';
import { confidence as asConfidence } from '@nexa/models';
import type { CompanionId, InsightId, UserId } from '@nexa/shared';
import type { ReflectionConfig } from './config.js';
import { DEFAULT_CONFIG } from './config.js';
import { bandFor, decayed, stabilityOf } from './score.js';
import { statementFor } from './statement.js';

/**
 * What time alone does, and how a decision becomes state.
 *
 * Split from `reflect.ts` for the same reason memory splits forgetting from
 * formation: the two run on different schedules and answer different questions.
 * A reflection pass asks *"what does this new evidence mean?"*; a review pass
 * asks *"is this still worth holding?"*, and it needs no evidence to answer —
 * which is what lets it run over an entire store cheaply.
 *
 * Both are pure and clock-free. `at` is supplied, so a review is reproducible
 * and a store's whole lifecycle can be replayed from its decisions.
 */

/**
 * Whether an insight should change on account of time, and how.
 *
 * Idempotent by construction: decay is derived from `evidenceConfidence` and
 * `lastSupportedAt`, neither of which this function moves. Running it twice at
 * the same instant returns the same decision, and applying that decision does
 * not change what the next run concludes. A caller may therefore run it hourly,
 * daily, or twice by accident without an insight ageing at a rate that depends
 * on the schedule.
 *
 * The order is expiry, then decay, and it matters. Expiry is a policy decision
 * taken when the insight was last supported; decay is a judgement made now.
 * A policy that has already run out does not need the arithmetic.
 */
export const reviewInsight = (
  insight: Insight,
  at: Timestamp,
  config: ReflectionConfig = DEFAULT_CONFIG,
): InsightDecision | null => {
  // Superseded and retired are terminal. Reviving either would make an
  // insight's history a loop rather than a record.
  if (insight.status !== 'active' && insight.status !== 'contested') return null;

  const policy = config.kinds[insight.kind];

  if (insight.expiresAt !== null && Date.parse(at) >= Date.parse(insight.expiresAt)) {
    return retirement(
      insight,
      'expired',
      at,
      `Its ${policy.ttlDays}-day life ran out at ${insight.expiresAt} without further support.`,
      'expiry_reached',
    );
  }

  const current = decayed(policy, insight.evidenceConfidence, insight.lastSupportedAt, at);

  if (current < policy.confidenceFloor) {
    return retirement(
      insight,
      'unsupported',
      at,
      `Confidence decayed to ${current.toFixed(2)}, under the ${policy.confidenceFloor.toFixed(2)} floor '${insight.kind}' requires to exist.`,
      'evidence_stale',
    );
  }

  // Nothing to report while the insight is inside its staleness window. An
  // engine that emitted a decision on every review would fill a history with
  // entries recording that nothing happened.
  if (current >= insight.confidence) return null;

  const certainty = bandFor(current);
  const statement = statementFor(policy, certainty, insight.polarity, insight.topic);
  const reworded = statement !== insight.statement;

  return {
    outcome: 'weaken',
    key: insight.key,
    targetId: insight.id,
    adjustment: {
      confidence: asConfidence(current),
      // Untouched. It is what the *evidence* supports, and no evidence changed.
      evidenceConfidence: insight.evidenceConfidence,
      certainty,
      stability: stabilityOf(
        policy,
        insight.supporting.length,
        insight.opposing.length,
        reworded ? insight.revision + 1 : insight.revision,
      ),
      status: insight.status,
      statement,
      revision: reworded ? insight.revision + 1 : insight.revision,
      supporting: insight.supporting,
      opposing: insight.opposing,
      expiresAt: insight.expiresAt,
      lastSupportedAt: insight.lastSupportedAt,
      updatedAt: at,
      change: {
        kind: 'decayed',
        at,
        detail: `No supporting evidence since ${insight.lastSupportedAt}; past the ${policy.stalenessDays}-day staleness window.`,
        confidenceBefore: insight.confidence,
        confidenceAfter: asConfidence(current),
      },
    },
    reasons: [
      {
        code: 'evidence_stale',
        detail: `Last supported at ${insight.lastSupportedAt}; '${insight.kind}' goes stale after ${policy.stalenessDays} days.`,
      },
    ],
  };
};

const retirement = (
  insight: Insight,
  reason: 'expired' | 'unsupported',
  at: Timestamp,
  detail: string,
  code: 'expiry_reached' | 'evidence_stale',
): InsightDecision => ({
  outcome: 'retire',
  key: insight.key,
  targetId: insight.id,
  reason,
  change: {
    kind: 'retired',
    at,
    detail,
    confidenceBefore: insight.confidence,
    confidenceAfter: asConfidence(0),
  },
  reasons: [{ code, detail }],
});

/**
 * Every insight in a set that time has moved.
 *
 * Order-preserving, so a replayed pass produces the same list in the same order
 * — which matters when the caller emits an event per decision.
 */
export const reviewPass = (
  insights: readonly Insight[],
  at: Timestamp,
  config: ReflectionConfig = DEFAULT_CONFIG,
): readonly InsightDecision[] =>
  insights
    .map((insight) => reviewInsight(insight, at, config))
    .filter((decision): decision is InsightDecision => decision !== null);

/**
 * Turns a draft into a stored insight.
 *
 * The id comes from the caller, which is the whole reason drafts exist. Minting
 * one here would put randomness inside a function whose value is that it has
 * none, and a replay would produce a store that differed from the original in
 * every identifier.
 */
export const materialise = (
  draft: InsightDraft,
  id: InsightId,
  userId: UserId,
  companionId: CompanionId,
): Insight => ({
  id,
  userId,
  companionId,
  key: draft.key,
  kind: draft.kind,
  topicKey: draft.topicKey,
  topic: draft.topic,
  polarity: draft.polarity,
  statement: draft.statement,
  status: draft.status,
  certainty: draft.certainty,
  confidence: draft.confidence,
  evidenceConfidence: draft.evidenceConfidence,
  stability: draft.stability,
  supporting: draft.supporting,
  opposing: draft.opposing,
  createdAt: draft.createdAt,
  updatedAt: draft.updatedAt,
  lastSupportedAt: draft.lastSupportedAt,
  expiresAt: draft.expiresAt,
  revision: draft.revision,
  supersedes: draft.supersedes,
  supersededBy: null,
  retirement: null,
  provenance: draft.provenance,
  history: draft.history,
});

/** Applies an adjustment, prepending its change to the bounded history. */
export const applyAdjustment = (
  insight: Insight,
  adjustment: InsightAdjustment,
  config: ReflectionConfig = DEFAULT_CONFIG,
): Insight => ({
  ...insight,
  statement: adjustment.statement,
  status: adjustment.status,
  certainty: adjustment.certainty,
  confidence: adjustment.confidence,
  evidenceConfidence: adjustment.evidenceConfidence,
  stability: adjustment.stability,
  revision: adjustment.revision,
  supporting: adjustment.supporting,
  opposing: adjustment.opposing,
  expiresAt: adjustment.expiresAt,
  lastSupportedAt: adjustment.lastSupportedAt,
  updatedAt: adjustment.updatedAt,
  history: bounded(adjustment.change, insight.history, config),
});

/**
 * Marks an insight retired. Nothing is deleted.
 *
 * A retired insight keeps its statement, its evidence references and its whole
 * history. It has left circulation, not existence — the same distinction memory
 * draws between forgetting and deletion, and for the same reason: "you used to
 * think I preferred tea" should be answerable.
 */
export const retire = (
  insight: Insight,
  reason: Insight['retirement'],
  change: InsightChange,
  config: ReflectionConfig = DEFAULT_CONFIG,
): Insight => ({
  ...insight,
  status: 'retired',
  retirement: reason,
  confidence: change.confidenceAfter,
  updatedAt: change.at,
  history: bounded(change, insight.history, config),
});

/**
 * Most recent first, truncated.
 *
 * Bounded because an insight is read on the path that assembles a turn's
 * context, and an unbounded array on a hot object is how a companion that has
 * known someone for three years gets slower than one that met them yesterday.
 * The full record belongs in the event log, which is append-only and read by
 * nothing on the critical path.
 */
const bounded = (
  change: InsightChange,
  history: readonly InsightChange[],
  config: ReflectionConfig,
): readonly InsightChange[] => [change, ...history].slice(0, config.maxHistory);

/**
 * Folds decisions into a store.
 *
 * The function that makes the replay claim testable rather than aspirational.
 * Given the same starting insights, the same decisions and the same id minter,
 * it produces the same store — so `reflect` followed by `applyDecisions`, run
 * twice over a user's history, yields two identical results.
 *
 * `mint` is supplied for the same reason drafts carry no id. A caller that wants
 * a reproducible replay passes a deterministic minter; one writing to a real
 * store passes `newInsightId`.
 */
export const applyDecisions = (
  insights: readonly Insight[],
  decisions: readonly InsightDecision[],
  userId: UserId,
  companionId: CompanionId,
  mint: (draft: InsightDraft) => InsightId,
  config: ReflectionConfig = DEFAULT_CONFIG,
): readonly Insight[] => {
  const byId = new Map(insights.map((insight) => [insight.id, insight]));
  const formed: Insight[] = [];

  for (const decision of decisions) {
    switch (decision.outcome) {
      case 'form': {
        formed.push(materialise(decision.draft, mint(decision.draft), userId, companionId));
        break;
      }

      case 'replace': {
        const superseded = byId.get(decision.targetId);
        const replacement = materialise(
          decision.draft,
          mint(decision.draft),
          userId,
          companionId,
        );
        formed.push(replacement);
        if (superseded !== undefined) {
          byId.set(decision.targetId, {
            ...superseded,
            status: 'superseded',
            supersededBy: replacement.id,
            retirement: 'superseded',
            updatedAt: decision.draft.updatedAt,
            history: bounded(
              {
                kind: 'replaced',
                at: decision.draft.updatedAt,
                detail: `Superseded by ${replacement.id}.`,
                confidenceBefore: superseded.confidence,
                confidenceAfter: superseded.confidence,
              },
              superseded.history,
              config,
            ),
          });
        }
        break;
      }

      case 'retire': {
        const target = byId.get(decision.targetId);
        if (target !== undefined) {
          byId.set(decision.targetId, retire(target, decision.reason, decision.change, config));
        }
        break;
      }

      case 'reinforce':
      case 'weaken':
      case 'contest':
      case 'revise': {
        const target = byId.get(decision.targetId);
        if (target !== undefined) {
          byId.set(decision.targetId, applyAdjustment(target, decision.adjustment, config));
        }
        break;
      }

      case 'decline':
        break;
    }
  }

  return [...byId.values(), ...formed];
};

/**
 * Whether an insight may be said out loud.
 *
 * Deliberately stricter than "does it exist". The gap between
 * `KindPolicy.confidenceFloor` and `ReflectionConfig.assertionFloor` is where
 * the companion keeps something it suspects and declines to mention — which is
 * the difference between a companion that is quiet and one that has no idea.
 *
 * A contested insight is never asserted. While the evidence is split, the
 * honest move is to ask rather than to tell, and a consumer that had to work
 * that out from `status` would eventually forget to.
 */
export const assertable = (
  insight: Insight,
  config: ReflectionConfig = DEFAULT_CONFIG,
): boolean =>
  insight.status === 'active' && insight.confidence >= config.assertionFloor;

/**
 * Insights a consumer should actually use, strongest first.
 *
 * Ranked by confidence *times* stability rather than by confidence alone. A
 * claim the companion is sure of but keeps revising should not outrank a
 * slightly less certain one it has held steadily — the second is the better
 * thing to build a sentence on, and ranking by confidence would put it second.
 */
export const rankAssertable = (
  insights: readonly Insight[],
  config: ReflectionConfig = DEFAULT_CONFIG,
): readonly Insight[] =>
  insights
    .filter((insight) => assertable(insight, config))
    .sort(
      (a, b) =>
        b.confidence * b.stability - a.confidence * a.stability ||
        a.key.localeCompare(b.key),
    );
