/**
 * `@nexa/reflection` — turning what happened into what it means.
 *
 * Memory remembers. Reflection understands. The whole package exists to keep
 * those two verbs apart: a `Memory` is something that happened and belongs to
 * the user; an `Insight` is a conclusion drawn from several of them and belongs
 * to the companion. Nothing here writes a memory, edits one, or can be mistaken
 * for one.
 *
 * ```ts
 * reflect(request)                  → ReflectionResult   // form | reinforce | contest | …
 * reviewInsight(insight, at)        → InsightDecision | null
 * applyDecisions(store, decisions)  → Insight[]
 * ```
 *
 * ## What it does not do
 *
 * No clock, no randomness, no model, no database, no retrieval, no prompts, no
 * I/O. Every input arrives as an argument: the evidence window, the insights
 * already held, the instant, and the identifiers. Each of those is somewhere an
 * ordinary implementation would reach for the environment, and each would end
 * the property the engine is built around — **the same request always produces
 * the same decisions**, so a user's understanding can be reconstructed from
 * their memories years later and every belief traced to the evidence that
 * founded it.
 *
 * ## It never invents and never diagnoses
 *
 * Two rules do most of the work, and both are structural rather than
 * aspirational.
 *
 * **Generalisation is written down.** Rolling "Unity", "VR" and "AI" up into
 * "building interactive technology" needs knowledge a pure function does not
 * have, so it lives in an explicit theme table. When no theme matches, the
 * engine does not guess a broader phrase — it keeps the user's own word.
 * Generalising further also requires *breadth*: a theme claim needs evidence
 * about several distinct things, so three remarks about Unity support "the user
 * enjoys Unity" and never "the user enjoys building interactive technology".
 *
 * **Statements are composed, not generated.** Every sentence the engine can
 * produce is a template in `kinds.ts` with a hedge chosen by certainty band. The
 * `condition` kind — the one that describes how someone is *right now* — is
 * capped below the confident band and hedged at every band it has, so there is
 * no evidence, tuning or configuration by which "they mentioned being tired"
 * becomes "they are burnt out". It can say someone may currently be overworking.
 * That is the whole of its licence.
 *
 * ## Nothing is permanent, and nothing compounds
 *
 * Every kind expires; understanding that is never re-earned has stopped tracking
 * the person it is about. And a memory the companion wrote from its own
 * reflection is never evidence for a further one — without that rule an insight
 * corroborates itself through the memory store, and confidence grows without a
 * single new thing having happened.
 *
 * ## Where the vocabulary lives
 *
 * `Insight`, `InsightDecision`, `InsightEvidence` and the rest are in
 * `@nexa/models`, not here. They have to be: `@nexa/core` may never import a
 * capability package, so anything Core or a sibling engine reads sits beneath
 * both. This package holds the rules, not their shapes.
 */

export type { ReflectionRequest } from './reflect.js';
export { reflect } from './reflect.js';

export {
  reviewInsight,
  reviewPass,
  materialise,
  applyAdjustment,
  applyDecisions,
  retire,
  assertable,
  rankAssertable,
} from './lifecycle.js';

export type { KindPolicy } from './kinds.js';
export {
  KIND_POLICIES,
  policyFor,
  CERTAINTY_CEILING,
  PROBABLE_AT,
  CONFIDENT_AT,
} from './kinds.js';

export type { ReflectionConfig } from './config.js';
export { DEFAULT_CONFIG, SOURCE_WEIGHT } from './config.js';

export type { Theme, ThemeIndex } from './themes.js';
export { DEFAULT_THEMES, indexThemes, themeFor, licenses } from './themes.js';

export type { Observation, KindMarkers } from './observe.js';
export { observe, eligible, KIND_MARKERS } from './observe.js';

export type { Cluster } from './cluster.js';
export { cluster, spanDaysOf } from './cluster.js';

export type { Scoring, Factors } from './score.js';
export {
  score,
  bandFor,
  stabilityOf,
  decayed,
  extendedExpiry,
  licensedPolarity,
} from './score.js';

export { statementFor } from './statement.js';

export type { Token } from './text.js';
export { tokenize, stem, words, similarity, negates } from './text.js';
