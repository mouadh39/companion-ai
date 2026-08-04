/**
 * `@nexa/perception` — noticing, and stopping there.
 *
 * Memory stores. Reflection understands. Retrieval selects. Planning decides.
 * Generation responds. Perception notices — and the value of this package is as
 * much in what it refuses to do as in what it does.
 *
 * ```ts
 * perceive(request)                    → PerceptionOutcome
 * toPerception(outcome, percepts)      → Perception            // Core's contract
 * stanceFor(outcome, dimension)        → 'observed' | 'possible' | 'unknown'
 * ```
 *
 * Pure, total, clock-free, model-free and store-free. Identical input produces
 * byte-identical output, so a turn can be replayed from its log and "why did it
 * think she was upset?" is answerable a year later.
 *
 * ## Observed, possible, unknown
 *
 * The distinction the engine turns on, and the line is drawn at the utterance
 * rather than at a confidence threshold:
 *
 * ```
 *   "I am frustrated."        → observed   — they said so
 *   "I guess nothing works."  → possible   — something went badly; nobody said how they feel
 *   ""                        → unknown    — and unknown is reported, not implied by absence
 * ```
 *
 * `possible` is capped at `POSSIBLE_CEILING` whatever its dimension allows, so
 * no chain of hints ever reaches the confidence of a statement. Unknowns are
 * reported with a *reason*, because a companion with no camera and a companion
 * looking at a neutral face know different things and a missing map key cannot
 * tell them apart.
 *
 * ## Confidence is never borrowed
 *
 * `score()` takes one observation's own evidence and is never handed the
 * collection — the rule is enforced by the signature rather than by discipline.
 * Two channels that agree yield two observations, each at its own confidence;
 * what to make of the agreement belongs to whoever is deciding, not to whoever
 * is noticing. The failure this prevents is easy to write by accident: three
 * hedged hints, each worth 0.4, combining into one 0.85 claim about a person's
 * inner life.
 *
 * ## It produces no summary
 *
 * No primary emotion, no overall mood, no single intent. Someone can be pleased
 * and exhausted in one sentence, agreeable and unconvinced in another, and every
 * reading is reported at its own confidence with the pairs that sit oddly
 * together listed as `tensions` — reported, never resolved. Choosing between
 * them is a decision, and decisions belong downstream.
 *
 * ## Built for channels that do not exist yet
 *
 * Today Nexa reads text. Tomorrow it reads prosody, expression, gaze and
 * posture. Adding one is: a member of `PerceptChannel`, a percept interface, and
 * an entry in `PerceptionConfig.extractors`. Nothing in the observation model,
 * the confidence model, the stance rule or the unknown reporting changes —
 * because an `Observation` already records which channel saw it, and nothing
 * anywhere merges observations across channels.
 *
 * ## Where the vocabulary lives
 *
 * `Observation`, `PerceptionOutcome`, `Percept` and the rest are in
 * `@nexa/models`. They have to be: `@nexa/core` may never import a capability
 * package, so anything Core or a sibling engine reads sits beneath both. This
 * package holds the rules, not their shapes.
 */

export type { PerceptionRequest } from './perceive.js';
export { perceive, stanceFor, observationsOf } from './perceive.js';

export { toPerception, INTENT_FLOOR, SUPPORT_FLOOR } from './bridge.js';

export type { PerceptionConfig } from './config.js';
export { DEFAULT_CONFIG, DEFAULT_EXTRACTORS } from './config.js';

export type { DimensionPolicy } from './dimensions.js';
export {
  DIMENSION_POLICIES,
  policyFor,
  ceilingFor,
  POSSIBLE_CEILING,
  OBSERVED_CEILING,
} from './dimensions.js';

export type { Scored } from './confidence.js';
export {
  score,
  magnitudeOf,
  BONUS_PER_EXTRA_CUE,
  MAX_CORROBORATION_BONUS,
} from './confidence.js';

export type { ExtractionContext, RawSignal, SignalExtractor } from './registry.js';
export { asChannel, reachableDimensions, availableDimensions } from './registry.js';

export { tensionsIn, TENSION_FLOOR } from './conflicts.js';

export { textCommunicationExtractor, VERBOSITY_SATURATION_WORDS, MIN_WORDS_FOR_STYLE } from './text/communication.js';
export { textConversationExtractor, TOPIC_OVERLAP_FLOOR, TOPIC_WINDOW } from './text/conversation.js';
export { textEmotionExtractor } from './text/emotion.js';
export { textInteractionExtractor, referencesIn } from './text/interaction.js';

export {
  STRENGTH,
  EMOTION_WORDS,
  SELF_REPORT_PREFIXES,
  NEGATIVE_OUTCOME_PHRASES,
  HEDGE_PHRASES,
  padded,
  matches,
  evidence,
} from './text/lexicon.js';
