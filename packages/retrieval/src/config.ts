import type { RetrievalClass } from '@nexa/models';
import type { ClassPolicy } from './classes.js';
import { CLASS_POLICIES } from './classes.js';
import { estimateTokens } from './budget.js';

/**
 * Everything the engine's judgement depends on, in one value.
 *
 * Frozen at every level, because two users' retrievals share this object inside
 * one process and a mutable default table is a cross-tenant bug waiting to be
 * written. Every field here is a number someone will eventually want to tune;
 * having them in one place is what makes tuning a decision rather than a search.
 */
export interface RetrievalConfig {
  readonly classes: Readonly<Record<RetrievalClass, ClassPolicy>>;

  /**
   * How strongly a candidate must anchor to be considered at all.
   *
   * The most consequential number in the engine. Too low and "I'm working on
   * Unity today" drags in the pizza preference on the strength of a shared
   * stop-word; too high and a companion with a rich history retrieves nothing
   * because no single memory restates the question. It is deliberately applied
   * to the *strongest* anchor rather than to their sum, so one genuinely
   * relevant dimension is enough and six weak ones are not.
   */
  readonly relevanceFloor: number;

  /** Above this overlap, two candidates are saying the same thing. */
  readonly duplicateThreshold: number;

  /** Memories and insights below this confidence are not candidates. */
  readonly minConfidence: number;

  /**
   * How many exclusions are reported.
   *
   * The one part of the result that grows with the size of the candidate set,
   * which over years is the part that grows without bound. Truncated rather than
   * dropped, and always paired with a complete `excludedCount` — a short list
   * with an honest total is inspectable; a short list alone understates what was
   * passed over.
   */
  readonly maxExplanations: number;

  /** Turns text into a token count. Must be pure. */
  readonly estimate: (text: string) => number;

  /**
   * Whether the assembled expression profile may shrink the item budget.
   *
   * A companion asked to be brief should not be carrying twelve memories it has
   * no room to use. Scaling is bounded and only ever *downward*: expression is
   * a communication style, and letting it raise a retrieval ceiling would let a
   * personality setting spend the caller's token budget.
   */
  readonly detailScaling: Readonly<Record<'minimal' | 'brief' | 'moderate' | 'thorough', number>>;
}

export const DEFAULT_CONFIG: RetrievalConfig = Object.freeze({
  classes: Object.freeze(CLASS_POLICIES),
  relevanceFloor: 0.25,
  duplicateThreshold: 0.7,
  minConfidence: 0.3,
  maxExplanations: 50,
  estimate: estimateTokens,
  detailScaling: Object.freeze({
    minimal: 0.4,
    brief: 0.65,
    moderate: 1,
    thorough: 1,
  }),
});
