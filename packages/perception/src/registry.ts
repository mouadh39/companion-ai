import type {
  ConversationTurn,
  ObservationDimension,
  ObservationEvidence,
  ObservationStance,
  Percept,
  PerceptChannel,
  RelationshipProfile,
  Timestamp,
} from '@nexa/models';

/**
 * The extension seam.
 *
 * Everything perception can notice arrives through an extractor, and an
 * extractor is a pure function from one percept to raw signals. That is the
 * whole contract, and it is deliberately the narrowest thing that could work —
 * because the requirement it exists to meet is that adding voice, face, gaze or
 * posture must be *registering a module*, never redesigning the model.
 *
 * What a new channel does **not** get to change:
 *
 * - The observation model. A prosody reading of frustration is an `Observation`
 *   on the `frustration` dimension with `channel: 'voice'`, sitting beside the
 *   text one rather than merged into it.
 * - The confidence model. `score` sees one observation's evidence and cannot be
 *   handed another's, whatever channel it came from.
 * - The stance rule. A raised voice is `possible` frustration for the same
 *   reason "I guess nothing works" is: it is inferred about the person rather
 *   than stated by them.
 * - The unknown reporting. A dimension no supplied channel can speak to is
 *   `no_channel`, which is how a deployment without a camera stays legible.
 *
 * What it does get: a member of `PerceptChannel`, a percept interface, and an
 * entry in the extractor list.
 */

/**
 * What an extractor may look at besides its own percept.
 *
 * Read-only and deliberately thin. An extractor gets the conversation so it can
 * notice a topic shift, and the relationship so it can *calibrate* — someone
 * terse with everyone is not being terse with the companion. It does not get
 * memories, insights, goals or retrieved context, and the omission is the point:
 * an extractor that could see what the companion knows would start noticing
 * things because they were expected rather than because they were there.
 */
export interface ExtractionContext {
  /** Oldest first. Empty on a first turn. */
  readonly conversation: readonly ConversationTurn[];
  /** Null before any relationship exists. Never required. */
  readonly relationship: RelationshipProfile | null;
  /** The instant being perceived. Supplied — nothing here reads a clock. */
  readonly at: Timestamp;
}

/**
 * One reading, before it is scored and turned into an `Observation`.
 *
 * An extractor decides *what* it saw, *how much* of it, and *what evidence*
 * supports it. It does not decide how confident to be — that is `confidence.ts`,
 * applied uniformly, so no extractor can quietly grant itself more credence than
 * its dimension's policy allows.
 */
export interface RawSignal {
  readonly dimension: ObservationDimension;
  readonly stance: ObservationStance;
  /** How much of the thing, 0–1. Clamped later. */
  readonly magnitude: number;
  readonly evidence: readonly ObservationEvidence[];
}

/**
 * A pure function from one percept to what it shows.
 *
 * `channel` is declared rather than inferred so the engine can report which
 * dimensions had a channel available at all — the difference between "the face
 * showed nothing" and "there was no camera", which no map of results can
 * express.
 *
 * `dimensions` is likewise declared: it is what an extractor *could* find, so
 * that a dimension nobody is looking for is reported as `no_channel` instead of
 * silently never appearing.
 */
export interface SignalExtractor {
  readonly id: string;
  readonly channel: PerceptChannel;
  /** Every dimension this extractor is capable of reporting. */
  readonly dimensions: readonly ObservationDimension[];
  /**
   * Pure. Same percept and context, same signals, in the same order.
   *
   * Returns an empty array rather than throwing when it cannot read the percept
   * — a client that sends a payload shape this extractor does not recognise
   * should degrade, not fail a turn.
   */
  readonly extract: (percept: Percept, context: ExtractionContext) => readonly RawSignal[];
}

/** Narrows a percept to its channel, or null. The one place a cast is licensed. */
export const asChannel = <T extends Percept>(
  percept: Percept,
  channel: PerceptChannel,
): T | null => (percept.channel === channel ? (percept as T) : null);

/** Every dimension the supplied extractors could report on. */
export const reachableDimensions = (
  extractors: readonly SignalExtractor[],
): ReadonlySet<ObservationDimension> => {
  const reachable = new Set<ObservationDimension>();
  for (const extractor of extractors) {
    for (const dimension of extractor.dimensions) reachable.add(dimension);
  }
  return reachable;
};

/** Every dimension reachable given the channels actually supplied this turn. */
export const availableDimensions = (
  extractors: readonly SignalExtractor[],
  channels: ReadonlySet<PerceptChannel>,
): ReadonlySet<ObservationDimension> => {
  const available = new Set<ObservationDimension>();
  for (const extractor of extractors) {
    if (!channels.has(extractor.channel)) continue;
    for (const dimension of extractor.dimensions) available.add(dimension);
  }
  return available;
};
