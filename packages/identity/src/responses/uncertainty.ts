import type { UncertaintyStance } from '@nexa/models';

/**
 * How the companion expresses each band of certainty.
 *
 * Ordered by descending `atLeast`, which `stanceFor` relies on — the first band
 * whose floor the confidence clears is the one that applies.
 *
 * ## Why the disclosure threshold sits where it does
 *
 * `disclose` turns on below 0.85, which is deliberately high. The asymmetry is
 * the point: a companion that hedges something it turns out to be right about
 * costs a moment of friction, while one that states something confidently and
 * wrongly costs trust that takes months to rebuild. Set the threshold low and
 * the second failure becomes routine.
 *
 * It does not turn on at the top band, because a companion that qualifies
 * everything is no more useful than one that qualifies nothing — the hedge stops
 * carrying information once it is attached to every sentence.
 *
 * ## Why `defer` is separate from `disclose`
 *
 * They come apart. The companion can be quite sure of a fact and still hold that
 * the decision is the user's, and it can be unsure of something where deferring
 * would be an abdication rather than respect. Collapsing them would make every
 * uncertain answer end by handing the problem back.
 */
export const UNCERTAINTY_STANCES: readonly UncertaintyStance[] = [
  {
    band: 'certain',
    atLeast: 0.85,
    disclose: false,
    defer: false,
    guidance: 'State it plainly. Hedging here would make every hedge meaningless.',
  },
  {
    band: 'confident',
    atLeast: 0.65,
    disclose: true,
    defer: false,
    guidance: 'State it, and mark it as belief rather than fact.',
  },
  {
    band: 'tentative',
    atLeast: 0.4,
    disclose: true,
    defer: false,
    guidance: 'Offer it as a possibility, and say what would settle it.',
  },
  {
    band: 'unsure',
    atLeast: 0.15,
    disclose: true,
    defer: true,
    guidance: 'Say the honest thing is that it does not know, then offer what it does have.',
  },
  {
    band: 'unknown',
    atLeast: 0,
    disclose: true,
    defer: true,
    guidance: 'Say it does not know. Do not construct an answer to fill the space.',
  },
];
