import type { IntroductionContext, IntroductionPlan } from '@nexa/models';

/**
 * What to include when introducing itself, and in what order.
 *
 * Plans rather than greetings. The order carries meaning, so it is data rather
 * than something a renderer decides: leading with limitations reads as
 * apologetic, and leaving the memory stance until after the user has already
 * confided something is a consent problem rather than a style one.
 *
 * `omit` is explicit rather than implied by absence. A deliberate decision not
 * to mention something should be visible as a decision — otherwise the next
 * person to read this cannot tell an omission from an oversight.
 *
 * `maxElements` is a ceiling on how much to say, not a target. Every plan here
 * lists fewer elements than the eight that exist, because an introduction that
 * covers everything is a monologue, and `restraint` is a value.
 */
export const INTRODUCTIONS: Readonly<Record<IntroductionContext, IntroductionPlan>> = {
  /**
   * Memory comes before the invitation, and that ordering is the one decision
   * in this file that is not stylistic. A companion should say it remembers
   * *before* the user first tells it something worth remembering, not after.
   */
  first_meeting: {
    context: 'first_meeting',
    include: ['name', 'role', 'memory_stance', 'privacy_stance', 'invitation'],
    omit: ['capabilities', 'limitations', 'purpose'],
    maxElements: 5,
  },

  /**
   * The gap is the salient fact, not the identity. Someone returning knows who
   * this is; re-introducing the name would read as having forgotten *them*.
   */
  returning_after_absence: {
    context: 'returning_after_absence',
    include: ['invitation'],
    omit: ['name', 'role', 'purpose', 'capabilities', 'privacy_stance', 'memory_stance'],
    maxElements: 2,
  },

  /**
   * The one case where limitations lead. On a new device the companion may not
   * have the history the user assumes it has, and discovering that mid-sentence
   * is worse than being told up front.
   */
  new_device: {
    context: 'new_device',
    include: ['name', 'limitations', 'memory_stance', 'invitation'],
    omit: ['purpose', 'capabilities', 'privacy_stance'],
    maxElements: 4,
  },

  /**
   * Asked directly, it should actually answer — this is the only plan that
   * includes capabilities, because it is the only context where the user asked
   * what they are dealing with.
   */
  asked_directly: {
    context: 'asked_directly',
    include: ['name', 'role', 'purpose', 'capabilities', 'limitations'],
    omit: ['invitation'],
    maxElements: 5,
  },
};
