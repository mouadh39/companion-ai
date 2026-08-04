import type { Observation, Tension } from '@nexa/models';
import { policyFor } from './dimensions.js';

/**
 * Noticing that two readings sit oddly together — and doing nothing about it.
 *
 * The temptation here is to resolve: pick the stronger, suppress the weaker,
 * return one coherent picture. That temptation is the failure. People are
 * agreeable and annoyed in one sentence, pleased and exhausted in one afternoon,
 * certain about the plan and hesitant about the timing. An engine that resolved
 * those would be manufacturing a coherence the interaction did not have, and
 * would do it invisibly.
 *
 * So both observations stand, at their own confidences, and the tension becomes
 * a third thing the caller can read. Generation may well want to name it out
 * loud — "you sound pleased about the result and pretty worn out" is a better
 * sentence than either half alone.
 *
 * **Nothing here changes a confidence.** A tension is a report about a pair, not
 * an adjustment to either — for the same reason no observation may borrow
 * confidence from another. Disagreement between two readings is not evidence
 * against either one; it is a fact about the message.
 */

/**
 * Below this, a pair is too faint to be worth calling a tension.
 *
 * Both sides must clear it. Without a floor, every marginal reading pairs with
 * every other marginal reading and the tension list becomes longer than the
 * observation list — noise that trains a reader to ignore the field.
 */
export const TENSION_FLOOR = 0.35;

/**
 * Pairs of opposed dimensions that were both observed.
 *
 * Returned in a stable order — by dimension name — so two identical inputs
 * produce identical output, and each unordered pair appears once. Emitting
 * `(joy, sadness)` and `(sadness, joy)` as two tensions would double-count a
 * single fact about the message.
 */
export const tensionsIn = (observations: readonly Observation[]): readonly Tension[] => {
  const byDimension = new Map<string, Observation>();

  for (const observation of observations) {
    if (observation.confidence < TENSION_FLOOR) continue;
    // The strongest reading per dimension represents it. Two channels reporting
    // frustration is not a tension; it is agreement, and agreement is not this
    // function's business.
    const held = byDimension.get(observation.dimension);
    if (held === undefined || observation.confidence > held.confidence) {
      byDimension.set(observation.dimension, observation);
    }
  }

  const tensions: Tension[] = [];
  const seen = new Set<string>();

  for (const observation of [...byDimension.values()].sort((a, b) =>
    a.dimension.localeCompare(b.dimension),
  )) {
    const opposite = policyFor(observation.dimension).opposes;
    if (opposite === null) continue;

    const counterpart = byDimension.get(opposite);
    if (counterpart === undefined) continue;

    const pair = [observation.dimension, opposite].sort();
    const key = pair.join('|');
    if (seen.has(key)) continue;
    seen.add(key);

    const [left, right] = pair;
    if (left === undefined || right === undefined) continue;

    tensions.push({
      dimensions: [observation.dimension, opposite],
      detail: `Both '${left}' and '${right}' were observed in the same turn; neither was suppressed.`,
    });
  }

  return tensions;
};
