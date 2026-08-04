import type { InsightCertainty, InsightPolarity } from '@nexa/models';
import type { KindPolicy } from './kinds.js';

/**
 * Putting a claim into words.
 *
 * Composition from a fixed template, never generation. That is not a limitation
 * being worked around — it is the requirement. This sentence is asserted to
 * someone as a thing the companion believes about them, and a sentence a model
 * wrote is one nobody reviewed, nobody can predict, and nobody can reproduce
 * from the same evidence a year later.
 *
 * Every sentence this engine can produce is a template in `kinds.ts` with a
 * hedge from that kind's table and a topic from the theme lexicon or the user's
 * own words. The complete set is finite, enumerable, and readable in two files.
 *
 * ## The hedge carries the verb
 *
 * "may prefer" and "consistently prefers" cannot share a slot in front of one
 * verb, so the whole verb phrase lives in the hedge table. The consequence is
 * that certainty and phrasing cannot drift apart: there is no way to raise
 * confidence without the sentence changing to match, because the sentence is
 * built from the band.
 */

const TOPIC_SLOT = '{topic}';
const HEDGE_SLOT = '{hedge}';

export const statementFor = (
  policy: KindPolicy,
  certainty: InsightCertainty,
  polarity: InsightPolarity,
  topic: string,
): string => {
  const hedges = polarity === 'affirms' ? policy.hedges : policy.negativeHedges;

  return policy.template
    .split(HEDGE_SLOT)
    .join(hedges[certainty])
    .split(TOPIC_SLOT)
    .join(topic);
};
