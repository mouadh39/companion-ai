import type { InsightKind } from '@nexa/models';
import type { KindPolicy } from './kinds.js';
import { KIND_POLICIES } from './kinds.js';
import type { Theme } from './themes.js';
import { DEFAULT_THEMES } from './themes.js';

/**
 * Everything the engine's judgement depends on, in one value.
 *
 * The config is not a convenience. It is what makes `ruleset` meaningful: an
 * insight records which configuration produced it, so a store containing
 * insights formed under three different tunings is still explainable. Change the
 * thresholds without changing the tag and that guarantee is gone — the numbers
 * printed beside a two-year-old insight would be numbers that never applied to
 * it.
 *
 * Passing a config is optional and `DEFAULT_CONFIG` is frozen at every level, so
 * a caller cannot mutate the defaults out from under another caller in the same
 * process. That matters more here than in most places: two users' reflection
 * passes share this object.
 */
export interface ReflectionConfig {
  /**
   * The generalisation lexicon. Replaceable wholesale.
   *
   * Order is meaningful — a marker claimed by two themes resolves to the first —
   * so a caller supplying its own list is choosing precedence as well as content.
   */
  readonly themes: readonly Theme[];

  readonly kinds: Readonly<Record<InsightKind, KindPolicy>>;

  /**
   * Memories below this confidence are not evidence.
   *
   * Reflection compounds: a conclusion inherits every error in what it was drawn
   * from and adds its own. Filtering shaky memories out at the door is cheaper
   * than trying to price them once they are inside the arithmetic.
   */
  readonly minEvidenceConfidence: number;

  /**
   * How many topics one memory may contribute.
   *
   * A cap rather than a ranking, taken in order of appearance so it is
   * deterministic. Without it a long message about a busy week seeds a dozen
   * one-word clusters, and while each would be declined, the declines alone
   * would drown the pass's own explanation.
   */
  readonly maxTopicsPerMemory: number;

  /**
   * How many new insights one pass may form.
   *
   * Reflection over a long history can legitimately discover a great deal at
   * once, and a companion that comes back from a quiet week with forty new
   * beliefs about someone has not understood them better — it has just been
   * given more text. Overflow is declined as `pass_capacity` and reconsidered
   * next pass, so nothing is lost, only slowed.
   */
  readonly maxFormationsPerPass: number;

  /** How many history entries an insight keeps. Most recent first. */
  readonly maxHistory: number;

  /** Above this overlap, two memories in one cluster are the same remark. */
  readonly duplicateThreshold: number;

  /**
   * Below this confidence an insight is held but never asserted.
   *
   * Separate from `confidenceFloor`, which decides whether an insight *exists*.
   * The gap between them is where the engine keeps something it suspects and
   * declines to say — which is the difference between a companion that is quiet
   * and one that has no idea.
   */
  readonly assertionFloor: number;

  /** Version tag recorded on every insight this config forms. */
  readonly ruleset: string;
}

export const DEFAULT_CONFIG: ReflectionConfig = Object.freeze({
  themes: Object.freeze(DEFAULT_THEMES),
  kinds: Object.freeze(KIND_POLICIES),
  minEvidenceConfidence: 0.4,
  maxTopicsPerMemory: 6,
  maxFormationsPerPass: 8,
  maxHistory: 20,
  duplicateThreshold: 0.7,
  assertionFloor: 0.4,
  ruleset: 'reflection/1',
});

/**
 * How much a memory's provenance counts toward corroborating a pattern.
 *
 * Related to memory's `SOURCE_CONFIDENCE` and asking a different question. That
 * table asks "how likely is this to be true?"; this one asks "how much does this
 * corroborate a pattern?", and the answers differ — an observation is decent
 * evidence that something happened and weak evidence about what it meant.
 *
 * **`reflection` is absent, and that absence is load-bearing.** A memory the
 * companion wrote from its own conclusion is not evidence for another
 * conclusion. Admitting it would let an insight corroborate itself through the
 * memory store, and confidence would grow without a single new thing having
 * happened. `eligible` in `observe.ts` rejects those memories outright; this map
 * is total over the sources that survive that filter.
 */
export const SOURCE_WEIGHT: Readonly<Record<string, number>> = Object.freeze({
  user_stated: 0.95,
  conversation: 0.75,
  observation: 0.7,
});
