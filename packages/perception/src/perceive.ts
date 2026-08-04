import type {
  ConversationTurn,
  Observation,
  ObservationDimension,
  Percept,
  PerceptChannel,
  PerceptionOutcome,
  PerceptionReason,
  Reference,
  RelationshipProfile,
  Stance,
  TextPercept,
  Timestamp,
  UnknownDimension,
} from '@nexa/models';
import { OBSERVATION_DIMENSIONS, confidence as asConfidence } from '@nexa/models';
import type { PerceptionConfig } from './config.js';
import { DEFAULT_CONFIG } from './config.js';
import { magnitudeOf, score } from './confidence.js';
import { tensionsIn } from './conflicts.js';
import { policyFor } from './dimensions.js';
import type { ExtractionContext, RawSignal, SignalExtractor } from './registry.js';
import { availableDimensions } from './registry.js';
import { referencesIn } from './text/interaction.js';

/**
 * One perception pass: percepts in, observations out.
 *
 * Pure, total, clock-free, model-free and store-free. Identical input produces
 * byte-identical output, which is what lets a turn be replayed from its log —
 * and what makes "why did it think she was upset?" answerable a year later
 * rather than only while the process that decided it is still running.
 *
 * ## It notices and then it stops
 *
 * There is no primary emotion here, no overall mood, no single intent, no
 * summary. Each of those is an *interpretation*, and every one of them is a
 * decision some other engine is better placed to make with more context.
 * Perception's whole job is to produce the raw readings honestly and hand them
 * over; the moment it starts choosing between them it has become a planner with
 * a modest name.
 *
 * ## The order of the pass
 *
 * 1. **Channels** — what was supplied, and therefore what could be looked at.
 * 2. **Extraction** — each extractor sees one percept and its context.
 * 3. **Scoring** — one uniform confidence rule, applied to each signal's own
 *    evidence and nothing else.
 * 4. **Floors** — readings too faint to act on become `no_evidence`.
 * 5. **Unknowns** — everything examined and not found, and everything no
 *    supplied channel could speak to.
 * 6. **Tensions** — pairs that sit oddly together, reported and not resolved.
 */

export interface PerceptionRequest {
  /**
   * What was captured, one entry per channel.
   *
   * A list rather than a message, because that is the shape the multimodal
   * future needs and retrofitting it later means changing every caller. Today
   * it usually holds one `TextPercept`.
   */
  readonly percepts: readonly Percept[];

  /** Recent exchanges, oldest first. Used only for topic continuity. */
  readonly conversation?: readonly ConversationTurn[];

  /**
   * Who the two of them are to each other.
   *
   * Available for calibration and deliberately used by nothing today. Someone
   * terse with everyone is not being terse with the companion — but knowing that
   * needs a baseline this engine does not yet have, and inventing one would be
   * perception doing exactly the inference it forbids elsewhere. The seam exists;
   * it is honestly empty.
   */
  readonly relationship?: RelationshipProfile | null;

  /** The instant perceived. Never a clock reading. */
  readonly at: Timestamp;

  readonly config?: PerceptionConfig;
}

export const perceive = (request: PerceptionRequest): PerceptionOutcome => {
  const config = request.config ?? DEFAULT_CONFIG;
  const reasons: PerceptionReason[] = [];

  const channels = [...new Set(request.percepts.map((percept) => percept.channel))];
  const channelSet = new Set<PerceptChannel>(channels);

  const context: ExtractionContext = {
    conversation: request.conversation ?? [],
    relationship: request.relationship ?? null,
    at: request.at,
  };

  // ── 1. channels ────────────────────────────────────────────────────────
  reasons.push({
    code: 'channel_examined',
    detail:
      channels.length === 0
        ? 'No percepts supplied; nothing could be observed.'
        : `Examined ${channels.length} channel(s): ${channels.join(', ')}.`,
  });

  for (const percept of request.percepts) {
    if (!config.extractors.some((extractor) => extractor.channel === percept.channel)) {
      reasons.push({
        code: 'no_extractor',
        detail: `A '${percept.channel}' percept was supplied but nothing is registered to read it; it was ignored.`,
      });
    }
  }

  // ── 2 & 3. extract, then score uniformly ───────────────────────────────
  const observations: Observation[] = [];
  const belowFloor = new Set<ObservationDimension>();
  let ran = 0;

  for (const extractor of config.extractors) {
    for (const percept of request.percepts) {
      if (percept.channel !== extractor.channel) continue;

      ran++;
      for (const signal of extractor.extract(percept, context)) {
        const observation = toObservation(signal, extractor, percept, config);
        if (observation === null) {
          belowFloor.add(signal.dimension);
          continue;
        }
        observations.push(observation);
      }
    }
  }

  reasons.push({
    code: 'extractor_ran',
    detail: `${ran} extractor pass(es) produced ${observations.length} observation(s).`,
  });

  const empty = request.percepts.every(
    (percept) => percept.channel !== 'text' || (percept as TextPercept).text.trim().length === 0,
  );
  if (empty) {
    reasons.push({
      code: 'input_empty',
      detail: 'No text content to read. Silence is unknown, not neutral.',
    });
  }

  // ── 4 & 5. what was not found, and why ─────────────────────────────────
  const reachable = availableDimensions(config.extractors, channelSet);
  const found = new Set(observations.map((observation) => observation.dimension));

  const unknown: readonly UnknownDimension[] = config.reportUnknown
    ? OBSERVATION_DIMENSIONS.filter((dimension) => !found.has(dimension)).map((dimension) => ({
        dimension,
        family: policyFor(dimension).family,
        ...unknownReason(dimension, reachable, belowFloor, empty),
      }))
    : [];

  // ── 6. tensions ────────────────────────────────────────────────────────
  const tensions = tensionsIn(observations);
  for (const tension of tensions) {
    reasons.push({
      code: 'tension_found',
      detail: tension.detail,
    });
  }

  return {
    observations: ordered(observations),
    unknown,
    tensions,
    references: referencesFrom(request.percepts, config.maxReferences),
    channels,
    reasons,
    at: request.at,
  };
};

/**
 * Applies the one confidence rule and the dimension's floor.
 *
 * Every signal from every extractor goes through here, and nothing else assigns
 * a confidence. That uniformity is what stops an extractor granting itself more
 * credence than its dimension allows — and, since `score` is handed one signal's
 * evidence and never the collection, it is also what makes confidence borrowing
 * structurally impossible rather than merely discouraged.
 */
const toObservation = (
  signal: RawSignal,
  extractor: SignalExtractor,
  percept: Percept,
  config: PerceptionConfig,
): Observation | null => {
  if (signal.evidence.length === 0) return null;

  const policy = config.dimensions[signal.dimension];
  const scored = score(signal.dimension, signal.stance, signal.evidence);
  if (scored.confidence < policy.floor) return null;

  return {
    dimension: signal.dimension,
    family: policy.family,
    stance: signal.stance,
    channel: extractor.channel,
    magnitude: magnitudeOf(signal.magnitude),
    confidence: asConfidence(scored.confidence),
    evidence: signal.evidence,
    at: percept.at,
  };
};

/**
 * Why a dimension yielded nothing.
 *
 * Three answers, and they call for different responses. `no_channel` means the
 * deployment cannot see this at all — a companion without a camera should not be
 * told the user's expression was neutral. `insufficient_input` means there was
 * nothing to read. `no_evidence` means it was looked for and was not there,
 * which is the only one of the three that says anything about the user.
 */
const unknownReason = (
  dimension: ObservationDimension,
  reachable: ReadonlySet<ObservationDimension>,
  belowFloor: ReadonlySet<ObservationDimension>,
  empty: boolean,
): { readonly reason: UnknownDimension['reason']; readonly detail: string } => {
  if (!reachable.has(dimension)) {
    return {
      reason: 'no_channel',
      detail: 'No supplied channel can report this dimension.',
    };
  }
  if (empty) {
    return {
      reason: 'insufficient_input',
      detail: 'There was no content to read.',
    };
  }
  if (belowFloor.has(dimension)) {
    return {
      reason: 'no_evidence',
      detail: 'Something was matched but it fell below the floor this dimension requires.',
    };
  }
  return { reason: 'no_evidence', detail: 'Looked for and not found.' };
};

/**
 * A total order over observations.
 *
 * Family, then dimension, then channel, then confidence. Grouping by family
 * rather than sorting by confidence is deliberate: a confidence-sorted list
 * invites a reader to treat the top entry as *the* reading, which is precisely
 * the summary this engine refuses to produce. Sorted by family, the output reads
 * as what it is — a set of independent measurements.
 */
const ordered = (observations: readonly Observation[]): readonly Observation[] =>
  [...observations].sort(
    (a, b) =>
      a.family.localeCompare(b.family) ||
      a.dimension.localeCompare(b.dimension) ||
      a.channel.localeCompare(b.channel) ||
      b.confidence - a.confidence,
  );

const referencesFrom = (percepts: readonly Percept[], limit: number): readonly Reference[] => {
  const references: Reference[] = [];

  for (const percept of percepts) {
    if (percept.channel !== 'text') continue;
    references.push(...referencesIn((percept as TextPercept).text, limit - references.length));
    if (references.length >= limit) break;
  }

  return references;
};

/**
 * The three-way answer for one dimension.
 *
 * The brief's observed / possible / unknown, answered as a query rather than as
 * twenty-nine rows per turn. Where several channels disagree about stance, the
 * firmer one wins the *answer* — but both observations remain in the outcome,
 * because this is a convenience for readers who want one word and not a
 * replacement for reading them.
 */
export const stanceFor = (
  outcome: PerceptionOutcome,
  dimension: ObservationDimension,
): Stance => {
  let best: Stance = 'unknown';

  for (const observation of outcome.observations) {
    if (observation.dimension !== dimension) continue;
    if (observation.stance === 'observed') return 'observed';
    best = 'possible';
  }

  return best;
};

/** Every observation on one dimension, across every channel. */
export const observationsOf = (
  outcome: PerceptionOutcome,
  dimension: ObservationDimension,
): readonly Observation[] =>
  outcome.observations.filter((observation) => observation.dimension === dimension);
