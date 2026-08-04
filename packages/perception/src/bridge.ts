import type {
  EmotionSignal,
  IntentCandidate,
  IntentKind,
  Observation,
  ObservationDimension,
  Perception,
  PerceptionOutcome,
  TextPercept,
  Percept,
} from '@nexa/models';
import { confidence as asConfidence } from '@nexa/models';
import { policyFor } from './dimensions.js';

/**
 * The projection down to Core's existing contract.
 *
 * `PerceptionPort` returns `Perception` — text, ranked intents, one emotion,
 * entities — and Core reads it on the critical path of every turn. Widening that
 * to carry twenty-nine dimensions across several channels would be a breaking
 * change to the one interface the turn cannot afford to break, so this engine
 * does not touch it. It projects.
 *
 * The projection is lossy in three specific ways, each of which is a decision
 * rather than an accident:
 *
 * 1. **One emotion instead of several.** `Perception.emotion` is a single
 *    nullable reading. The strongest is chosen; the rest stay on the outcome.
 *    Callers that need the whole picture — including the case where someone is
 *    plainly two things at once — read `PerceptionOutcome` directly.
 * 2. **Stance is flattened into confidence.** Core has no vocabulary for
 *    observed-versus-possible. Since `possible` is already capped well below
 *    `observed`, the distinction survives as a number even though it stops being
 *    a word — a projection that lost it entirely would let an inference arrive
 *    at Core looking exactly like a statement.
 * 3. **Communication dimensions are dropped.** Verbosity and hesitation have
 *    nowhere to go in `IntentKind`, and inventing an intent for them would put
 *    a claim into Core's vocabulary that Core's consumers would misread.
 */

/**
 * Which dimensions correspond to which of Core's intents.
 *
 * Several map to one — `learning` and `question` are both questions to Core, and
 * `brainstorming` reads as planning. The collapse is the projection's, not the
 * vocabulary's: perception keeps the finer reading and hands over the coarse one
 * that Core's existing consumers were written against.
 */
const INTENT_MAP: Readonly<Partial<Record<ObservationDimension, IntentKind>>> = {
  question: 'question',
  learning: 'question',
  help_request: 'request',
  planning: 'planning',
  brainstorming: 'planning',
  correction: 'correction',
  greeting: 'casual',
  farewell: 'casual',
  casual: 'casual',
  reflection: 'statement',
};

/**
 * Emotional readings that make a turn one asking for support.
 *
 * Narrow, and gated on confidence at the call site. `emotional_support` changes
 * how the companion answers, so admitting it on a faint reading is how someone
 * gets consoled for a mood they were never in.
 */
const SUPPORT_DIMENSIONS: readonly ObservationDimension[] = [
  'sadness',
  'anxiety',
  'frustration',
  'fatigue',
];

/** Below this, an observation is not strong enough to become one of Core's intents. */
export const INTENT_FLOOR = 0.35;

/** Below this, an emotional reading is not passed to Core at all. */
export const SUPPORT_FLOOR = 0.5;

const strongestPerIntent = (
  observations: readonly Observation[],
): ReadonlyMap<IntentKind, number> => {
  const best = new Map<IntentKind, number>();

  for (const observation of observations) {
    const intent = INTENT_MAP[observation.dimension];
    if (intent === undefined || observation.confidence < INTENT_FLOOR) continue;

    // The strongest wins rather than the sum. Adding them would let three weak
    // hints outrank one clear question — the same borrowing forbidden upstream,
    // arriving through the projection instead.
    const held = best.get(intent) ?? 0;
    if (observation.confidence > held) best.set(intent, observation.confidence);
  }

  return best;
};

/**
 * The strongest emotional reading, or null.
 *
 * Ties break on dimension name so the choice is reproducible. That an arbitrary
 * tie-break is needed at all is a symptom of the shape being projected into:
 * Core asks for one emotion and a person may be two, and the honest place for
 * that information is the outcome this function is discarding.
 */
const strongestEmotion = (observations: readonly Observation[]): EmotionSignal | null => {
  let best: Observation | null = null;

  for (const observation of observations) {
    if (observation.family !== 'emotion') continue;
    if (policyFor(observation.dimension).asUserEmotion === null) continue;
    if (observation.confidence < SUPPORT_FLOOR) continue;

    if (
      best === null ||
      observation.confidence > best.confidence ||
      (observation.confidence === best.confidence &&
        observation.dimension.localeCompare(best.dimension) < 0)
    ) {
      best = observation;
    }
  }

  if (best === null) return null;

  const emotion = policyFor(best.dimension).asUserEmotion;
  if (emotion === null) return null;

  return {
    emotion,
    intensity: asConfidence(best.magnitude),
    confidence: asConfidence(best.confidence),
  };
};

export const toPerception = (
  outcome: PerceptionOutcome,
  percepts: readonly Percept[],
): Perception => {
  const text = percepts.find(
    (percept): percept is TextPercept => percept.channel === 'text',
  );

  const intents: IntentCandidate[] = [...strongestPerIntent(outcome.observations)]
    .map(([kind, value]) => ({ kind, confidence: asConfidence(value) }))
    // Confidence, then name: a stable order, because `primaryIntent` reads the
    // first entry and a tie resolved by iteration order would make the
    // companion's behaviour depend on map insertion.
    .sort((a, b) => b.confidence - a.confidence || a.kind.localeCompare(b.kind));

  const supportive = outcome.observations.some(
    (observation) =>
      SUPPORT_DIMENSIONS.includes(observation.dimension) &&
      observation.confidence >= SUPPORT_FLOOR,
  );
  if (supportive && !intents.some((intent) => intent.kind === 'emotional_support')) {
    intents.push({ kind: 'emotional_support', confidence: asConfidence(0.6) });
    intents.sort((a, b) => b.confidence - a.confidence || a.kind.localeCompare(b.kind));
  }

  const body = text?.text.trim().replace(/\s+/gu, ' ') ?? '';
  if (intents.length === 0 && body.length > 0) {
    // Core's contract expects at least one intent for a non-empty message, and
    // `statement` is the honest default: something was said and nothing about it
    // indicated what it wanted.
    intents.push({ kind: 'statement', confidence: asConfidence(0.5) });
  }

  return {
    text: body,
    intents,
    emotion: strongestEmotion(outcome.observations),
    entities: outcome.references.map((reference) => reference.text),
  };
};
