import type { InsightCertainty, InsightEvidence, InsightPolarity, Timestamp } from '@nexa/models';
import { timestamp } from '@nexa/models';
import type { KindPolicy } from './kinds.js';
import { CERTAINTY_CEILING, CONFIDENT_AT, PROBABLE_AT } from './kinds.js';
import { round } from './text.js';

/**
 * How sure an insight is, and how settled — as arithmetic anyone can check.
 *
 * Confidence is a **product of four independent factors**, not a weighted sum.
 * The difference matters: a sum lets a strong signal carry a missing one, so
 * twenty restatements of a single remark could out-vote the fact that they all
 * arrived in one afternoon. A product cannot. Every factor is a veto in
 * proportion to how badly it is missing, which is the behaviour an engine tuned
 * to miss rather than invent needs.
 *
 * ```
 *   confidence = ceiling × evidence × quality × agreement × spread
 * ```
 *
 * - **evidence** — how many distinct memories, against the kind's saturation.
 * - **quality**  — mean provenance weight. What the user said outranks what the
 *   companion noticed.
 * - **agreement** — the share of evidence pointing the claim's way.
 * - **spread**   — how much calendar time it covers.
 *
 * The numbers this produces are low, and that is the intended reading. Three
 * clear statements from the user over three weeks land near 0.35 — "tentative",
 * phrased as *may*. Reaching "confident" takes a saturated evidence set of
 * high-provenance memories spread over time, and even then the ceiling stops
 * short of certainty.
 */

/**
 * What a same-day cluster keeps.
 *
 * Zero would be wrong: some patterns are legitimately visible in a single
 * conversation, and multiplying them out of existence would make the spread
 * factor a second, hidden minimum-spread gate — which the kind policy already
 * has, explicitly, in `minSpreadDays`. This one is a discount, not a veto.
 */
const SPREAD_BASE = 0.7;

export interface Factors {
  readonly evidence: number;
  readonly quality: number;
  readonly agreement: number;
  readonly spread: number;
}

export interface Scoring {
  readonly confidence: number;
  readonly certainty: InsightCertainty;
  readonly stability: number;
  readonly factors: Factors;
}

const sumWeights = (evidence: readonly { readonly weight: number }[]): number =>
  evidence.reduce((total, entry) => total + entry.weight, 0);

/**
 * Scores one claim from its evidence.
 *
 * `revision` and the opposing count feed stability rather than confidence, and
 * the separation is deliberate. An insight can be well-evidenced and unsettled
 * at the same time — revised three times, argued with twice — and collapsing the
 * two into one number would hide exactly the case a consumer most needs to know
 * about before saying it out loud.
 */
export const score = (
  policy: KindPolicy,
  supporting: readonly InsightEvidence[],
  opposing: readonly InsightEvidence[],
  spanDays: number,
  revision: number,
): Scoring => {
  if (supporting.length === 0) {
    return {
      confidence: 0,
      certainty: 'tentative',
      stability: 0,
      factors: { evidence: 0, quality: 0, agreement: 0, spread: 0 },
    };
  }

  const support = sumWeights(supporting);
  const against = sumWeights(opposing);

  const factors: Factors = {
    evidence: round(Math.min(1, supporting.length / Math.max(1, policy.saturationEvidence))),
    quality: round(support / supporting.length),
    agreement: support + against === 0 ? 0 : round(support / (support + against)),
    spread:
      policy.spreadSaturationDays <= 0
        ? 1
        : round(
            Math.min(
              1,
              SPREAD_BASE + (1 - SPREAD_BASE) * (spanDays / policy.spreadSaturationDays),
            ),
          ),
  };

  // The kind's own ceiling, then the absolute one. The second is not redundant:
  // the first is tuning and the second is the promise that no tuning can make
  // this engine certain about a person.
  const ceiling = Math.min(policy.ceiling, CERTAINTY_CEILING);
  const confidence = round(
    Math.max(
      0,
      Math.min(
        ceiling,
        ceiling * factors.evidence * factors.quality * factors.agreement * factors.spread,
      ),
    ),
  );

  return {
    confidence,
    certainty: bandFor(confidence),
    stability: stabilityOf(policy, supporting.length, opposing.length, revision),
    factors,
  };
};

/**
 * The band the wording follows.
 *
 * Wording tracks the band and not the number, so an insight does not re-word
 * itself every time a decimal moves. Crossing a boundary is a real change in
 * what the companion is prepared to say, and it is logged as a revision.
 */
export const bandFor = (confidence: number): InsightCertainty => {
  if (confidence >= CONFIDENT_AT) return 'confident';
  if (confidence >= PROBABLE_AT) return 'probable';
  return 'tentative';
};

/**
 * How much the insight has stopped moving.
 *
 * Corroboration divided by churn. Every revision and every piece of opposing
 * evidence is churn, and both push stability down however sure the claim
 * otherwise looks — which is the point. A claim revised three times is one the
 * companion keeps changing its mind about, and a consumer that leaned on
 * confidence alone would assert it as though it had always said so.
 */
export const stabilityOf = (
  policy: KindPolicy,
  supportCount: number,
  opposingCount: number,
  revision: number,
): number => {
  const corroboration = Math.min(1, supportCount / Math.max(1, policy.stableEvidence));
  const churn = 1 + revision + opposingCount;
  return round(corroboration / churn);
};

/**
 * What time alone does to an insight, with no new evidence.
 *
 * Measured from `lastSupportedAt` against `evidenceConfidence` — the value the
 * evidence supported when it was last added — rather than against whatever
 * confidence the insight currently holds. Decaying the current value would
 * compound: run the maintenance pass twice in a day and the insight would have
 * aged two days. Deriving it afresh each time makes `reviewInsight` idempotent,
 * which is what lets a caller run it on any schedule it likes, including twice.
 *
 * Nothing decays before `stalenessDays`. Understanding does not start rotting
 * the moment it is formed; it rots when it stops being re-earned.
 */
export const decayed = (
  policy: KindPolicy,
  evidenceConfidence: number,
  lastSupportedAt: Timestamp,
  at: Timestamp,
): number => {
  const start = Date.parse(lastSupportedAt);
  const now = Date.parse(at);
  if (!Number.isFinite(start) || !Number.isFinite(now)) return evidenceConfidence;

  const idleDays = Math.max(0, (now - start) / 86_400_000);
  if (idleDays <= policy.stalenessDays) return evidenceConfidence;

  // Linear across a second staleness window, so an insight left entirely alone
  // reaches zero at twice its staleness period — long after the floor has
  // already retired it. The floor is what ends an insight; this only gets it
  // there.
  const overdue = idleDays - policy.stalenessDays;
  const fraction = Math.min(1, overdue / Math.max(1, policy.stalenessDays));
  return round(Math.max(0, evidenceConfidence * (1 - fraction)));
};

/**
 * When an insight should be re-earned by, given support at `at`.
 *
 * Takes the later of the standing expiry and the extension, so support can only
 * lengthen a life — the same rule memory applies to reinforcement, for the same
 * reason. Setting it to `at + extension` outright looks equivalent and is not: a
 * long-lived insight supported today with a short extension would have its
 * expiry pulled *closer*, so being corroborated would shorten how long it is
 * kept.
 */
export const extendedExpiry = (
  policy: KindPolicy,
  current: Timestamp | null,
  at: Timestamp,
): Timestamp | null => {
  const extended = addDays(at, policy.reinforcementExtensionDays);
  if (current === null) return extended;
  return Date.parse(extended) > Date.parse(current) ? extended : current;
};

/**
 * Total over a malformed instant.
 *
 * Returns the input unchanged rather than throwing. A corrupt timestamp on one
 * insight should cost that insight its extension, not abort a maintenance pass
 * that has the rest of a user's understanding still to get through.
 */
export const addDays = (at: Timestamp, days: number): Timestamp => {
  const parsed = Date.parse(at);
  if (!Number.isFinite(parsed)) return at;
  return timestamp(new Date(parsed + days * 86_400_000).toISOString());
};

/** Whether a claim of this polarity may be stated at all for this kind. */
export const licensedPolarity = (policy: KindPolicy, polarity: InsightPolarity): boolean =>
  polarity === 'affirms' || policy.licensesDenial;
