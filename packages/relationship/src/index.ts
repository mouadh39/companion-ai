/**
 * `@nexa/relationship` — who Nexa and one user are to each other.
 *
 * Identity is fixed. Personality adapts within a turn. This moves over months,
 * and it is the state that makes a companion different from an assistant: an
 * assistant speaks the same way to everyone forever, and the same question can
 * deserve a different answer six months in.
 *
 * Two functions, both pure:
 *
 * - `deriveProfile(relationship, at)` — answers "who are we right now?"
 * - `advance(relationship, signal)` — applies one interaction
 *
 * Neither reads a clock, performs I/O, or calls a model. `at` is always
 * supplied, which is what makes `replay(from, signals)` reconstruct a
 * relationship exactly rather than approximately.
 *
 * ## What it does not do
 *
 * No memories, no emotion classification, no summarisation, no prompts. It
 * knows *how often* the two have worked together, *how long* they have known
 * each other, and *how it has gone* — never what was said or how anyone felt.
 * `InteractionSignal` carries structural facts only, and that is deliberate: a
 * relationship built on inferred feelings would move on the companion's guesses
 * about the user rather than on what actually happened between them.
 *
 * ## Nothing changes fast
 *
 * Every dimension is capped at `MAX_DIMENSION_DELTA_PER_INTERACTION` per
 * interaction, and each stage additionally requires an interaction count, a
 * span of elapsed days, and dimension thresholds — all at once. A single
 * remarkable conversation cannot move the relationship, by construction rather
 * than by choosing small numbers carefully.
 *
 * The vocabulary lives in `@nexa/models`: `@nexa/core` may never import a
 * capability package, so anything Core or a sibling engine reads sits beneath
 * both.
 */

export { deriveProfile, cadenceFor, initiativeFor, personalizationFor, sharedUnderstandingFor } from './derive.js';

export { advance, replay } from './advance.js';

export type { StageRequirement } from './stages.js';
export {
  STAGE_REQUIREMENTS,
  LAPSE_AFTER_DAYS,
  blockersFor,
  hasLapsed,
  stageFor,
  nextStageAfter,
  progressToward,
} from './stages.js';

export type { DimensionDeltas } from './signals.js';
export {
  DECAY_PER_DAY,
  deltasFor,
  applyDeltas,
  decayFamiliarity,
  countersAfter,
} from './signals.js';

export { daysBetween, averageGapDays } from './elapsed.js';
