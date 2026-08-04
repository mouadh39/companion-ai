import type {
  Insight,
  InsightAdjustment,
  InsightChange,
  InsightDecision,
  InsightDraft,
  InsightEvidence,
  InsightKey,
  InsightPolarity,
  Memory,
  ReflectionDecline,
  ReflectionReason,
  ReflectionResult,
  Timestamp,
} from '@nexa/models';
import { confidence as asConfidence } from '@nexa/models';
import type { MemoryId, UserId } from '@nexa/shared';
import type { Cluster } from './cluster.js';
import { cluster, spanDaysOf } from './cluster.js';
import type { ReflectionConfig } from './config.js';
import { DEFAULT_CONFIG } from './config.js';
import type { KindPolicy } from './kinds.js';
import type { Observation } from './observe.js';
import { eligible, observe } from './observe.js';
import { extendedExpiry, licensedPolarity, score } from './score.js';
import { statementFor } from './statement.js';
import { indexThemes } from './themes.js';

/**
 * One reflection pass: memories in, decisions out.
 *
 * Pure, total, clock-free, model-free and store-free. The same request always
 * produces the same result, which is what makes a user's understanding
 * **replayable**: re-running their memories in order reconstructs exactly the
 * insights they have, and "why do you think that about me?" is answerable from
 * the record rather than from a guess.
 *
 * The engine writes nothing and reads nothing. `memories` and `existing` are
 * supplied by the caller, `at` is supplied by the caller, ids are minted by the
 * caller. Every one of those is a place where an ordinary implementation would
 * reach for the environment, and every one of them would break replay.
 *
 * ## The order of the pass
 *
 * 1. **Eligibility** — what may be evidence at all.
 * 2. **Observation** — memories become claims they could bear on.
 * 3. **Clustering** — observations group by claim, duplicates collapse.
 * 4. **Gates** — the formation rules, cheapest and most absolute first.
 * 5. **Reconciliation** — what this means for insights already held.
 * 6. **Capacity** — how much one pass is allowed to conclude.
 *
 * Withdrawal is handled ahead of everything else, because it is not a judgement.
 * When the memories an insight rests on have been deleted, no amount of new
 * evidence about the same topic makes the old conclusion legitimate.
 */

export interface ReflectionRequest {
  readonly userId: UserId;
  /**
   * The evidence window. Supplied, never retrieved.
   *
   * Reflection performs no queries — deciding what a set of memories means and
   * finding the right set of memories are different problems, and fusing them
   * would make this engine impossible to test without a store and impossible to
   * reason about when the store is slow. The caller chooses the window; a wider
   * one finds more patterns and costs more.
   */
  readonly memories: readonly Memory[];
  /** Insights already held. Only `active` and `contested` ones are reconciled. */
  readonly existing: readonly Insight[];
  /**
   * Memories the caller knows are gone — deleted by the user, or forgotten.
   *
   * The engine cannot infer this: a memory absent from the window might have
   * been deleted or might simply be outside it, and treating absence as deletion
   * would retire an insight every time the caller narrowed its query. So it is
   * told. This is what makes the user's deletion right reach conclusions as well
   * as memories — deleting the evidence and leaving the belief standing would be
   * a promise only half kept.
   */
  readonly withdrawn?: readonly MemoryId[];
  readonly at: Timestamp;
  readonly config?: ReflectionConfig;
}

export const reflect = (request: ReflectionRequest): ReflectionResult => {
  const config = request.config ?? DEFAULT_CONFIG;
  const { at } = request;
  const withdrawn = new Set<string>(request.withdrawn ?? []);
  const reasons: ReflectionReason[] = [];

  // ── 1. eligibility ─────────────────────────────────────────────────────
  const evidenceWindow = request.memories.filter((memory) =>
    eligible(memory, at, withdrawn, config),
  );
  reasons.push({
    code: 'evidence_gathered',
    detail: `${evidenceWindow.length} of ${request.memories.length} supplied memories are eligible as evidence.`,
  });
  if (evidenceWindow.length < request.memories.length) {
    const derived = request.memories.filter(
      (memory) => memory.source === 'reflection' || memory.type === 'reflective',
    ).length;
    reasons.push({
      code: 'evidence_excluded',
      detail: `${request.memories.length - evidenceWindow.length} excluded; ${derived} of those were themselves derived, which may never corroborate a further conclusion.`,
    });
  }

  // ── 2 & 3. observe, then cluster ───────────────────────────────────────
  const index = indexThemes(config.themes);
  const observations: Observation[] = [];
  for (const memory of evidenceWindow) observations.push(...observe(memory, index, config));

  const clusters = cluster(observations, config);
  reasons.push({
    code: 'pattern_clustered',
    detail: `${observations.length} observations grouped into ${clusters.length} candidate claims.`,
  });

  const provenance = {
    ruleset: config.ruleset,
    windowFrom: earliest(evidenceWindow, at),
    windowTo: latest(evidenceWindow, at),
  } as const;

  // ── withdrawal, before any judgement ───────────────────────────────────
  const standing = new Map<InsightKey, Standing>();
  // Evidence that has already produced a conclusion which has since been let
  // go. Re-forming from it would make expiry a loop: retire for want of fresh
  // support, re-form from the same memories, retire again.
  const spent = new Map<InsightKey, Set<string>>();

  for (const insight of request.existing) {
    if (insight.status === 'active' || insight.status === 'contested') {
      standing.set(insight.key, withdrawalApplied(insight, withdrawn, config, at));
      continue;
    }

    const seen = spent.get(insight.key) ?? new Set<string>();
    for (const entry of insight.supporting) seen.add(entry.memoryId);
    for (const entry of insight.opposing) seen.add(entry.memoryId);
    spent.set(insight.key, seen);
  }

  const decisions: InsightDecision[] = [];

  // ── 4 & 5. gates, then reconciliation ──────────────────────────────────
  for (const candidate of clusters) {
    const held = standing.get(candidate.key);
    // A conclusion already retired for want of evidence is not revived by more
    // evidence in the same pass. Next pass forms it afresh, from scratch, with
    // the deleted memories gone — which is the only honest way to rebuild it.
    if (held?.retire !== undefined) continue;

    if (held === undefined) {
      const alreadyDrawn = spent.get(candidate.key);
      if (alreadyDrawn !== undefined && nothingNew(candidate, alreadyDrawn)) {
        decisions.push({
          outcome: 'decline',
          key: candidate.key,
          reason: 'already_concluded',
          reasons: [
            {
              code: 'below_threshold',
              detail:
                'This conclusion has been drawn and let go on exactly these memories. Re-earning it needs evidence it did not already have.',
            },
          ],
        });
        continue;
      }

      decisions.push(formFrom(candidate, config, at, provenance));
      continue;
    }

    const decision = reconcile(candidate, held, config, at, provenance);
    if (decision !== null) decisions.push(decision);
  }

  // Insights no candidate touched. Absence of evidence in one window is not
  // evidence of absence — nothing here fades an insight for want of mentions.
  // Only withdrawal acts, because only withdrawal is a fact rather than a gap.
  for (const key of [...standing.keys()].sort()) {
    const held = standing.get(key);
    if (held === undefined) continue;
    if (held.retire !== undefined) {
      decisions.push(held.retire);
      continue;
    }
    if (held.removed === 0) continue;
    if (clusters.some((candidate) => candidate.key === key)) continue;
    decisions.push(weakenedByWithdrawal(held, config, at));
  }

  // ── 6. capacity ────────────────────────────────────────────────────────
  return { decisions: withinCapacity(decisions, config), reasons };
};

/** An insight as it stands once withdrawn evidence has been struck out. */
interface Standing {
  readonly insight: Insight;
  readonly supporting: readonly InsightEvidence[];
  readonly opposing: readonly InsightEvidence[];
  readonly removed: number;
  /** Set when withdrawal alone ends the insight. */
  readonly retire?: InsightDecision;
}

const withdrawalApplied = (
  insight: Insight,
  withdrawn: ReadonlySet<string>,
  config: ReflectionConfig,
  at: Timestamp,
): Standing => {
  const supporting = insight.supporting.filter((entry) => !withdrawn.has(entry.memoryId));
  const opposing = insight.opposing.filter((entry) => !withdrawn.has(entry.memoryId));
  const removed =
    insight.supporting.length - supporting.length + (insight.opposing.length - opposing.length);

  if (removed === 0) return { insight, supporting, opposing, removed };

  const policy = config.kinds[insight.kind];
  const scored = score(policy, supporting, opposing, spanDaysOf(supporting), insight.revision);

  if (supporting.length < policy.minEvidence || scored.confidence < policy.confidenceFloor) {
    const change: InsightChange = {
      kind: 'retired',
      at,
      detail: `${removed} supporting ${removed === 1 ? 'memory' : 'memories'} were deleted; what remains no longer supports the claim.`,
      confidenceBefore: insight.confidence,
      confidenceAfter: asConfidence(0),
    };
    return {
      insight,
      supporting,
      opposing,
      removed,
      retire: {
        outcome: 'retire',
        key: insight.key,
        targetId: insight.id,
        reason: 'evidence_withdrawn',
        change,
        reasons: [
          {
            code: 'evidence_withdrawn',
            detail: `Evidence fell to ${supporting.length} distinct ${supporting.length === 1 ? 'memory' : 'memories'}, under the ${policy.minEvidence} '${insight.kind}' requires.`,
          },
        ],
      },
    };
  }

  return { insight, supporting, opposing, removed };
};

const weakenedByWithdrawal = (
  held: Standing,
  config: ReflectionConfig,
  at: Timestamp,
): InsightDecision => {
  const { insight } = held;
  const policy = config.kinds[insight.kind];
  const scored = score(
    policy,
    held.supporting,
    held.opposing,
    spanDaysOf(held.supporting),
    insight.revision,
  );
  const statement = statementFor(policy, scored.certainty, insight.polarity, insight.topic);
  const revised = statement !== insight.statement;

  return {
    outcome: 'weaken',
    key: insight.key,
    targetId: insight.id,
    adjustment: {
      confidence: asConfidence(scored.confidence),
      evidenceConfidence: asConfidence(scored.confidence),
      certainty: scored.certainty,
      stability: scored.stability,
      status: held.opposing.length > 0 ? 'contested' : 'active',
      statement,
      revision: revised ? insight.revision + 1 : insight.revision,
      supporting: held.supporting,
      opposing: held.opposing,
      expiresAt: insight.expiresAt,
      lastSupportedAt: insight.lastSupportedAt,
      updatedAt: at,
      change: {
        kind: 'weakened',
        at,
        detail: `${held.removed} cited ${held.removed === 1 ? 'memory was' : 'memories were'} deleted.`,
        confidenceBefore: insight.confidence,
        confidenceAfter: asConfidence(scored.confidence),
      },
    },
    reasons: [
      {
        code: 'evidence_withdrawn',
        detail: `${held.removed} cited ${held.removed === 1 ? 'memory is' : 'memories are'} gone; confidence recomputed from what is left.`,
      },
    ],
  };
};

/**
 * The formation gates, in order.
 *
 * Cheapest and most absolute first, and every one of them is a reason to form
 * *nothing*. There is no path here that produces a weak insight rather than no
 * insight: a claim about a person either clears the bar its kind sets or it does
 * not exist, because a hedge is not a substitute for evidence.
 *
 * Declines carry their reasoning. A threshold nobody can see is a threshold
 * nobody can tune, and this engine is meant to be understood by reading it.
 */
const formFrom = (
  candidate: Cluster,
  config: ReflectionConfig,
  at: Timestamp,
  provenance: InsightDraft['provenance'],
): InsightDecision => {
  const policy = config.kinds[candidate.kind];
  const reasons: ReflectionReason[] = [];

  // Which way the evidence points. The stronger side proposes the claim; a tie
  // proposes nothing, because a claim the evidence splits on is one the
  // companion has no business holding.
  const affirms = candidate.affirming.length;
  const denies = candidate.denying.length;
  const polarity: InsightPolarity = affirms >= denies ? 'affirms' : 'denies';
  const forClaim = polarity === 'affirms' ? candidate.affirming : candidate.denying;
  const against = polarity === 'affirms' ? candidate.denying : candidate.affirming;
  const breadth =
    polarity === 'affirms' ? candidate.affirmingBreadth : candidate.denyingBreadth;

  reasons.push({
    code: 'agreement_measured',
    detail: `${affirms} affirming, ${denies} denying.`,
  });

  const decline = (reason: ReflectionDecline, detail: string): InsightDecision => ({
    outcome: 'decline',
    key: candidate.key,
    reason,
    reasons: [...reasons, { code: 'below_threshold', detail }],
  });

  if (!licensedPolarity(policy, polarity)) {
    return decline(
      'phrasing_not_licensed',
      `'${candidate.kind}' does not state denials on their own; the evidence is kept as opposition only.`,
    );
  }

  if (forClaim.length < policy.minEvidence) {
    const reason: ReflectionDecline =
      candidate.duplicatesDropped > 0 &&
      forClaim.length + candidate.duplicatesDropped >= policy.minEvidence
        ? 'evidence_not_distinct'
        : 'insufficient_evidence';
    return decline(
      reason,
      `${forClaim.length} distinct ${forClaim.length === 1 ? 'memory' : 'memories'} against the ${policy.minEvidence} '${candidate.kind}' requires${candidate.duplicatesDropped > 0 ? `, after ${candidate.duplicatesDropped} restatement(s) were collapsed` : ''}.`,
    );
  }

  if (candidate.viaTheme && breadth < policy.minThemeBreadth) {
    reasons.push({
      code: 'breadth_checked',
      detail: `${breadth} distinct underlying topic(s) behind the generalisation.`,
    });
    return decline(
      'insufficient_breadth',
      `A generalisation to '${candidate.topic}' needs ${policy.minThemeBreadth} distinct underlying topics; the evidence is all about ${breadth === 1 ? 'one thing' : `${breadth} things`}.`,
    );
  }

  const spanDays = spanDaysOf(forClaim);
  reasons.push({
    code: 'spread_checked',
    detail: `Evidence spans ${spanDays.toFixed(1)} days.`,
  });
  if (spanDays < policy.minSpreadDays) {
    return decline(
      'insufficient_spread',
      `'${candidate.kind}' needs ${policy.minSpreadDays} days of spread; this covers ${spanDays.toFixed(1)}.`,
    );
  }

  if (against.length >= forClaim.length) {
    return decline(
      'evidence_conflicts',
      `${against.length} memories point the other way against ${forClaim.length} for.`,
    );
  }

  const supporting = forClaim.map(asEvidence);
  const opposing = against.map(asEvidence);
  const scored = score(policy, supporting, opposing, spanDays, 0);

  reasons.push({
    code: 'confidence_scored',
    detail: `Confidence ${scored.confidence.toFixed(2)} = ceiling ${policy.ceiling.toFixed(2)} × evidence ${scored.factors.evidence.toFixed(2)} × quality ${scored.factors.quality.toFixed(2)} × agreement ${scored.factors.agreement.toFixed(2)} × spread ${scored.factors.spread.toFixed(2)}.`,
  });

  if (scored.confidence < policy.confidenceFloor) {
    return decline(
      'below_confidence_floor',
      `Confidence ${scored.confidence.toFixed(2)} is under the '${candidate.kind}' floor ${policy.confidenceFloor.toFixed(2)}.`,
    );
  }

  reasons.push({
    code: 'certainty_banded',
    detail: `Banded '${scored.certainty}', which is what the wording follows.`,
  });
  if (scored.confidence >= policy.ceiling) {
    reasons.push({
      code: 'capped_by_ceiling',
      detail: `Held at the '${candidate.kind}' ceiling of ${policy.ceiling.toFixed(2)}.`,
    });
  }

  const statement = statementFor(policy, scored.certainty, polarity, candidate.topic);
  const lastSupportedAt = latestOf(supporting, at);

  return {
    outcome: 'form',
    key: candidate.key,
    draft: {
      key: candidate.key,
      kind: candidate.kind,
      topicKey: candidate.topicKey,
      topic: candidate.topic,
      polarity,
      statement,
      status: opposing.length > 0 ? 'contested' : 'active',
      certainty: scored.certainty,
      confidence: asConfidence(scored.confidence),
      evidenceConfidence: asConfidence(scored.confidence),
      stability: scored.stability,
      supporting,
      opposing,
      createdAt: at,
      updatedAt: at,
      lastSupportedAt,
      expiresAt: extendedExpiry(policy, null, at),
      revision: 0,
      supersedes: null,
      provenance,
      history: [
        {
          kind: 'formed',
          at,
          detail: `Formed from ${supporting.length} distinct memories spanning ${spanDays.toFixed(1)} days.`,
          confidenceBefore: asConfidence(0),
          confidenceAfter: asConfidence(scored.confidence),
        },
      ],
    },
    reasons,
  };
};

/**
 * What a candidate means for an insight already held.
 *
 * Returns `null` when it means nothing — the candidate cites no memory the
 * insight does not already have, and the numbers are unchanged. That case is
 * common and worth handling explicitly: without it, re-running a pass over the
 * same window would emit a change every time, and an insight's history would
 * fill with entries recording that nothing happened.
 */
const reconcile = (
  candidate: Cluster,
  held: Standing,
  config: ReflectionConfig,
  at: Timestamp,
  provenance: InsightDraft['provenance'],
): InsightDecision | null => {
  const { insight } = held;
  const policy = config.kinds[insight.kind];

  const agreeing = insight.polarity === 'affirms' ? candidate.affirming : candidate.denying;
  const disagreeing = insight.polarity === 'affirms' ? candidate.denying : candidate.affirming;

  const flipped = flipsClaim(insight, held, disagreeing, policy);
  if (flipped) return replaceWith(held, disagreeing, config, at, provenance);

  const supporting = mergeEvidence(held.supporting, agreeing.map(asEvidence));
  const opposing = mergeEvidence(held.opposing, disagreeing.map(asEvidence));

  if (supporting.added === 0 && opposing.added === 0 && held.removed === 0) return null;

  const scored = score(
    policy,
    supporting.merged,
    opposing.merged,
    spanDaysOf(supporting.merged),
    insight.revision,
  );
  // The topic label is carried from the existing insight rather than from the
  // candidate. A label that drifted as evidence accumulated would rewrite the
  // statement and log a revision that reflects nothing about the user.
  const statement = statementFor(policy, scored.certainty, insight.polarity, insight.topic);
  const reworded = statement !== insight.statement;

  const outcome = pickOutcome(opposing.added, reworded, scored.confidence, insight);
  const reasons: ReflectionReason[] = [
    {
      code: 'matches_existing',
      detail: `Candidate matches held insight ${insight.id} (${insight.key}).`,
    },
    {
      code: 'confidence_scored',
      detail: `Confidence ${insight.evidenceConfidence.toFixed(2)} → ${scored.confidence.toFixed(2)} on ${supporting.merged.length} supporting and ${opposing.merged.length} opposing memories.`,
    },
    {
      code: reworded ? 'statement_revised' : 'statement_unchanged',
      detail: reworded
        ? `Certainty moved to '${scored.certainty}'; the wording follows.`
        : `Still '${scored.certainty}'; the wording is unchanged.`,
    },
  ];

  if (opposing.added > 0) {
    reasons.push({
      code: 'contradiction_found',
      detail: `${opposing.added} new ${opposing.added === 1 ? 'memory points' : 'memories point'} the other way, not enough to overturn the claim.`,
    });
  }

  const adjustment: InsightAdjustment = {
    confidence: asConfidence(scored.confidence),
    evidenceConfidence: asConfidence(scored.confidence),
    certainty: scored.certainty,
    stability: scored.stability,
    status: opposing.merged.length > 0 ? 'contested' : 'active',
    statement,
    revision: reworded ? insight.revision + 1 : insight.revision,
    supporting: supporting.merged,
    opposing: opposing.merged,
    // Expiry moves only on new support. Being argued with is not a reason to
    // keep a conclusion alive longer.
    expiresAt:
      supporting.added > 0 ? extendedExpiry(policy, insight.expiresAt, at) : insight.expiresAt,
    lastSupportedAt: supporting.added > 0 ? latestOf(supporting.merged, at) : insight.lastSupportedAt,
    updatedAt: at,
    change: {
      kind: changeKindFor(outcome),
      at,
      detail: detailFor(outcome, supporting.added, opposing.added, held.removed),
      confidenceBefore: insight.confidence,
      confidenceAfter: asConfidence(scored.confidence),
    },
  };

  return { outcome, key: insight.key, targetId: insight.id, adjustment, reasons };
};

/**
 * Whether the evidence has actually turned the claim over.
 *
 * Two conditions, and both are strict:
 *
 * 1. The opposing side has enough distinct memories to have founded the claim on
 *    its own. Anything less is disagreement, not a reversal.
 * 2. Every one of them is **newer than every memory supporting the standing
 *    claim**. That is what tells "they changed their mind" from "they have
 *    always been inconsistent about this" — and only the first is a reason to
 *    replace rather than to contest.
 *
 * Failing either, the insight is contested instead: held, visibly disputed, at
 * reduced confidence. That state is the honest one, and having it is what stops
 * every disagreement from forcing a choice between ignoring the new evidence and
 * overwriting the old conclusion.
 */
const flipsClaim = (
  insight: Insight,
  held: Standing,
  disagreeing: readonly Observation[],
  policy: KindPolicy,
): boolean => {
  if (disagreeing.length < policy.minEvidence) return false;

  const flippedPolarity: InsightPolarity =
    insight.polarity === 'affirms' ? 'denies' : 'affirms';
  if (!licensedPolarity(policy, flippedPolarity)) return false;

  const newestSupport = held.supporting.reduce<string>(
    (latestSeen, entry) => (entry.at > latestSeen ? entry.at : latestSeen),
    '',
  );
  return disagreeing.every((observation) => observation.at > newestSupport);
};

const replaceWith = (
  held: Standing,
  disagreeing: readonly Observation[],
  config: ReflectionConfig,
  at: Timestamp,
  provenance: InsightDraft['provenance'],
): InsightDecision => {
  const { insight } = held;
  const policy = config.kinds[insight.kind];
  const polarity: InsightPolarity = insight.polarity === 'affirms' ? 'denies' : 'affirms';

  const supporting = disagreeing.map(asEvidence);
  const spanDays = spanDaysOf(supporting);
  const scored = score(policy, supporting, [], spanDays, 0);
  const statement = statementFor(policy, scored.certainty, polarity, insight.topic);

  return {
    outcome: 'replace',
    key: insight.key,
    targetId: insight.id,
    draft: {
      key: insight.key,
      kind: insight.kind,
      topicKey: insight.topicKey,
      topic: insight.topic,
      polarity,
      statement,
      status: 'active',
      certainty: scored.certainty,
      confidence: asConfidence(scored.confidence),
      evidenceConfidence: asConfidence(scored.confidence),
      stability: scored.stability,
      supporting,
      // The old claim's evidence does not become opposition to the new one. It
      // was true when it was said; a superseded insight keeps its own record,
      // and carrying it forward would permanently contest a claim whose whole
      // point is that the user has moved on.
      opposing: [],
      createdAt: at,
      updatedAt: at,
      lastSupportedAt: latestOf(supporting, at),
      expiresAt: extendedExpiry(policy, null, at),
      revision: 0,
      supersedes: insight.id,
      provenance,
      history: [
        {
          kind: 'replaced',
          at,
          detail: `Replaces ${insight.id}: ${supporting.length} newer memories reverse the earlier claim.`,
          confidenceBefore: insight.confidence,
          confidenceAfter: asConfidence(scored.confidence),
        },
      ],
    },
    reasons: [
      {
        code: 'polarity_flipped',
        detail: `Every one of the ${supporting.length} contradicting memories is newer than all evidence for '${insight.statement}'.`,
      },
      {
        code: 'confidence_scored',
        detail: `The replacing claim starts at ${scored.confidence.toFixed(2)}, on its own evidence alone.`,
      },
    ],
  };
};

/**
 * Which of the four update outcomes this is.
 *
 * They share a payload and mean different things, and the ordering encodes which
 * meaning wins when several apply at once.
 *
 * **Contradiction leads.** An insight that gained supporting evidence *and*
 * opposing evidence in the same pass is one the user has said something against,
 * and reporting that as a reinforcement would bury the only part a person would
 * want to know about.
 *
 * **Direction outranks wording.** A claim whose confidence fell far enough to
 * change how it is phrased is reported as a weakening, not a revision — the
 * rewording is still there in `adjustment.statement` and `adjustment.revision`,
 * but "it got weaker" is the fact that would otherwise be lost. A revision is
 * therefore always an insight that got *surer* and said so.
 */
const pickOutcome = (
  opposingAdded: number,
  reworded: boolean,
  confidence: number,
  insight: Insight,
): 'contest' | 'revise' | 'reinforce' | 'weaken' => {
  if (opposingAdded > 0) return 'contest';
  if (confidence < insight.evidenceConfidence) return 'weaken';
  return reworded ? 'revise' : 'reinforce';
};

const changeKindFor = (
  outcome: 'contest' | 'revise' | 'reinforce' | 'weaken',
): InsightChange['kind'] =>
  outcome === 'contest'
    ? 'contested'
    : outcome === 'revise'
      ? 'revised'
      : outcome === 'weaken'
        ? 'weakened'
        : 'reinforced';

const detailFor = (
  outcome: 'contest' | 'revise' | 'reinforce' | 'weaken',
  supportingAdded: number,
  opposingAdded: number,
  removed: number,
): string => {
  const parts: string[] = [];
  if (supportingAdded > 0) parts.push(`${supportingAdded} new supporting`);
  if (opposingAdded > 0) parts.push(`${opposingAdded} new opposing`);
  if (removed > 0) parts.push(`${removed} withdrawn`);
  const evidence = parts.length > 0 ? parts.join(', ') : 'no change in evidence';
  return `${outcome === 'revise' ? 'Reworded' : outcome === 'contest' ? 'Contested' : outcome === 'weaken' ? 'Weakened' : 'Reinforced'}: ${evidence}.`;
};

/**
 * How much one pass is allowed to conclude.
 *
 * Only formations are capped. Updates are bounded by the insights already held,
 * and refusing to record that a standing belief was contradicted would be the
 * opposite of conservative. Overflow is declined as `pass_capacity` in place, so
 * the decision list stays in key order and nothing is silently dropped —
 * everything declined here is reconsidered next pass on the same evidence.
 */
const withinCapacity = (
  decisions: readonly InsightDecision[],
  config: ReflectionConfig,
): readonly InsightDecision[] => {
  const formations = decisions
    .map((decision, position) => ({ decision, position }))
    .filter((entry) => entry.decision.outcome === 'form');

  if (formations.length <= config.maxFormationsPerPass) return decisions;

  const admitted = new Set(
    [...formations]
      .sort((a, b) => {
        const left = a.decision.outcome === 'form' ? a.decision.draft.confidence : 0;
        const right = b.decision.outcome === 'form' ? b.decision.draft.confidence : 0;
        return right - left || a.decision.key.localeCompare(b.decision.key);
      })
      .slice(0, config.maxFormationsPerPass)
      .map((entry) => entry.position),
  );

  return decisions.map((decision, position) =>
    decision.outcome === 'form' && !admitted.has(position)
      ? {
          outcome: 'decline' as const,
          key: decision.key,
          reason: 'pass_capacity' as const,
          reasons: [
            ...decision.reasons,
            {
              code: 'below_threshold' as const,
              detail: `Sound, but beyond the ${config.maxFormationsPerPass} insights one pass forms. It will be reconsidered next pass.`,
            },
          ],
        }
      : decision,
  );
};

/**
 * Whether a candidate rests entirely on memories a let-go conclusion already used.
 *
 * The guard that keeps expiry meaningful. An insight expires because nothing has
 * supported it for months — but the memories that founded it are usually still
 * in the store, so the very next pass would re-form it, and the cycle would
 * repeat forever while the user's evidence sat unchanged. Understanding has to
 * be *re-earned*, and re-earning means new evidence, not the same evidence read
 * again.
 */
const nothingNew = (candidate: Cluster, spent: ReadonlySet<string>): boolean =>
  [...candidate.affirming, ...candidate.denying].every((observation) =>
    spent.has(observation.memoryId),
  );

const asEvidence = (observation: Observation): InsightEvidence => ({
  memoryId: observation.memoryId,
  at: observation.at,
  source: observation.source,
  polarity: observation.polarity,
  weight: observation.weight,
});

/**
 * Union by memory id, in a canonical order.
 *
 * Sorted rather than appended so two passes that discovered the same evidence in
 * different orders produce byte-identical evidence lists — which is what lets a
 * caller compare an insight to its replay with a deep equality check rather than
 * a bespoke comparison that would drift.
 */
const mergeEvidence = (
  held: readonly InsightEvidence[],
  incoming: readonly InsightEvidence[],
): { merged: readonly InsightEvidence[]; added: number } => {
  const known = new Set(held.map((entry) => entry.memoryId));
  const added = incoming.filter((entry) => !known.has(entry.memoryId));

  const merged = [...held, ...added].sort(
    (a, b) => a.at.localeCompare(b.at) || a.memoryId.localeCompare(b.memoryId),
  );

  return { merged, added: added.length };
};

const latestOf = (evidence: readonly InsightEvidence[], fallback: Timestamp): Timestamp =>
  evidence.reduce<Timestamp>((newest, entry) => (entry.at > newest ? entry.at : newest), evidence[0]?.at ?? fallback);

const earliest = (memories: readonly Memory[], fallback: Timestamp): Timestamp =>
  memories.reduce<Timestamp>(
    (oldest, memory) => (memory.createdAt < oldest ? memory.createdAt : oldest),
    memories[0]?.createdAt ?? fallback,
  );

const latest = (memories: readonly Memory[], fallback: Timestamp): Timestamp =>
  memories.reduce<Timestamp>(
    (newest, memory) => (memory.createdAt > newest ? memory.createdAt : newest),
    memories[0]?.createdAt ?? fallback,
  );
