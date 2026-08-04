import type { ConfidenceScore } from '../value-objects/score.js';
import type { Timestamp } from '../value-objects/timestamp.js';

/**
 * The vocabulary of *noticing*.
 *
 * Memory stores, reflection understands, retrieval selects, planning decides,
 * generation responds. Perception notices — and stops there. Nothing in this
 * file is a conclusion, a recommendation or a decision; every type here
 * describes something that was present in an interaction, how it was evidenced,
 * and how sure anyone should be about it.
 *
 * ## Why this is not `Perception`
 *
 * `Perception` in `perception.ts` is Core's existing contract — text, ranked
 * intents, one emotion, entities — and Core reads it on the critical path of
 * every turn. It is deliberately narrow, and widening it to carry twenty-nine
 * dimensions across several sensory channels would be a breaking change to the
 * one interface the turn cannot afford to break.
 *
 * So the two are bridged, not merged: `@nexa/perception` produces the rich
 * `PerceptionOutcome` below and projects it down to `Perception`, so the engine
 * drops in behind `PerceptionPort` without Core changing a line.
 *
 * ## Built for channels that do not exist yet
 *
 * Today Nexa perceives text. Tomorrow it perceives voice prosody, facial
 * expression, gaze, posture and room sensors. The seam for that is here rather
 * than deferred, because retrofitting it means rewriting every consumer:
 *
 * - A `Percept` is *one channel's* raw input, and the union is open at the
 *   channel enum rather than at the payload.
 * - An `Observation` records **which channel saw it**, so "she said she was
 *   frustrated" and "her voice sounded frustrated" are two observations, not
 *   one averaged guess.
 * - Nothing merges observations across channels. See `ObservationEvidence`.
 */

/**
 * A sensory channel.
 *
 * Every member beyond `text` is declared before anything produces it, and that
 * is the point: the channel is the extension seam, so adding voice must be
 * "register an extractor", never "change the observation model". Declaring them
 * now costs one line each and makes the seam real rather than promised.
 */
export type PerceptChannel =
  /** The message as written or transcribed. The only channel implemented today. */
  | 'text'
  /** How it was said — prosody, pace, volume. Not the words. */
  | 'voice'
  /** Facial expression. */
  | 'face'
  /** Where the user is looking. */
  | 'gaze'
  /** Posture and gesture. */
  | 'body'
  /** The environment: light, noise, motion. */
  | 'sensor'
  /** What the user did with the interface, as distinct from what they said. */
  | 'interaction';

export const PERCEPT_CHANNELS = [
  'text',
  'voice',
  'face',
  'gaze',
  'body',
  'sensor',
  'interaction',
] as const satisfies readonly PerceptChannel[];

/**
 * One channel's raw input for one moment.
 *
 * Structural rather than a closed union of payloads, and the difference is what
 * makes the architecture survive a new channel. An extractor declares the
 * channel it understands and narrows the percept itself; a percept the engine
 * has no extractor for is carried, reported as unexamined, and ignored — never
 * an error, because a client that sends camera frames to a deployment with no
 * face extractor should degrade, not fail.
 */
export interface Percept {
  readonly channel: PerceptChannel;
  /** When this was captured. Supplied — perception reads no clock. */
  readonly at: Timestamp;
}

/** The message, as written or transcribed. */
export interface TextPercept extends Percept {
  readonly channel: 'text';
  readonly text: string;
}

/** Which part of an interaction an observation is about. */
export type ObservationFamily = 'communication' | 'emotion' | 'conversation' | 'interaction';

export const OBSERVATION_FAMILIES = [
  'communication',
  'emotion',
  'conversation',
  'interaction',
] as const satisfies readonly ObservationFamily[];

/**
 * What can be noticed.
 *
 * A closed list, extended by adding a member and a row to the policy table. It
 * is closed for the same reason reflection's insight kinds are: an open-ended
 * "perception noticed something" would have no confidence policy to govern it
 * and no consumer able to act on it, and would become the seam through which an
 * unreviewed claim about a person entered the system.
 *
 * The emotion family is richer than `UserEmotion` deliberately. Perception's
 * vocabulary is its own; the projection to Core's narrower enum is lossy and
 * says so, rather than the vocabulary being trimmed to whatever the oldest
 * consumer happened to need.
 */
export type ObservationDimension =
  // ── communication: how it was said ──────────────────────────────────
  | 'verbosity'
  | 'directness'
  | 'uncertainty'
  | 'certainty'
  | 'hesitation'
  | 'urgency'
  // ── emotion: never a diagnosis, always a reading ────────────────────
  | 'frustration'
  | 'excitement'
  | 'curiosity'
  | 'sadness'
  | 'joy'
  | 'confusion'
  | 'anxiety'
  | 'fatigue'
  | 'pride'
  | 'calm'
  // ── conversation: what this turn is doing ───────────────────────────
  | 'topic_shift'
  | 'correction'
  | 'question'
  | 'agreement'
  | 'disagreement'
  | 'greeting'
  | 'farewell'
  // ── interaction: what the user wants from the exchange ──────────────
  | 'help_request'
  | 'planning'
  | 'reflection'
  | 'brainstorming'
  | 'learning'
  | 'casual';

export const OBSERVATION_DIMENSIONS = [
  'verbosity',
  'directness',
  'uncertainty',
  'certainty',
  'hesitation',
  'urgency',
  'frustration',
  'excitement',
  'curiosity',
  'sadness',
  'joy',
  'confusion',
  'anxiety',
  'fatigue',
  'pride',
  'calm',
  'topic_shift',
  'correction',
  'question',
  'agreement',
  'disagreement',
  'greeting',
  'farewell',
  'help_request',
  'planning',
  'reflection',
  'brainstorming',
  'learning',
  'casual',
] as const satisfies readonly ObservationDimension[];

/**
 * How firmly something is held.
 *
 * The distinction the whole engine turns on, and the line between the two is
 * drawn at the utterance rather than at a confidence threshold:
 *
 * - **observed** — it was *present in the interaction*. "I am frustrated" states
 *   frustration; a question mark is a question; a long message is verbose. These
 *   are readings of what happened.
 * - **possible** — it was *inferred about the person*. "I guess nothing works"
 *   suggests frustration and does not state it.
 *
 * A third stance, `unknown`, is not a value an observation can carry — an
 * observation that observed nothing is not an observation. It is reported
 * separately, as `UnknownDimension`, so "we looked and saw nothing" stays
 * distinguishable from "we never looked". `stanceFor` on the outcome answers the
 * three-way question without every turn emitting twenty-nine empty rows.
 */
export type ObservationStance = 'observed' | 'possible';

export const OBSERVATION_STANCES = [
  'observed',
  'possible',
] as const satisfies readonly ObservationStance[];

/** The three-way answer to "what do we know about this dimension?". */
export type Stance = ObservationStance | 'unknown';

export const STANCES = ['observed', 'possible', 'unknown'] as const satisfies readonly Stance[];

/**
 * How a piece of evidence was found.
 *
 * Carried per match rather than per observation, because one observation may
 * rest on several kinds at once and the *kind* is what a reader needs to judge
 * it. "They wrote the word 'frustrated' about themselves" and "the message was
 * in capitals" support the same dimension and deserve very different credence.
 */
export type EvidenceKind =
  /** The user asserted it of themselves. The strongest thing text can offer. */
  | 'self_report'
  /** A phrase associated with the dimension, not asserted of the self. */
  | 'phrase'
  /** A property of the message itself — punctuation, casing, length. */
  | 'structural'
  /** Something about how this turn relates to the previous ones. */
  | 'contextual'
  /** A measurement from a non-text channel. Prosody, expression, posture. */
  | 'signal';

export const EVIDENCE_KINDS = [
  'self_report',
  'phrase',
  'structural',
  'contextual',
  'signal',
] as const satisfies readonly EvidenceKind[];

/**
 * One reason an observation was made.
 *
 * `excerpt` is a span of the user's own message and nothing else. Perception
 * writes no prose: an explanation that paraphrased what someone said would be an
 * interpretation wearing an observation's clothes, and the point of quoting is
 * that a reader can check the engine's reading against the words.
 */
export interface ObservationEvidence {
  readonly kind: EvidenceKind;
  readonly channel: PerceptChannel;
  /** What was matched — a phrase, a pattern name, a measurement name. */
  readonly cue: string;
  /** The user's own words, verbatim and bounded. Empty for non-text channels. */
  readonly excerpt: string;
  /** How much this kind of evidence is worth on its own, 0–1. */
  readonly strength: number;
}

/**
 * One thing noticed.
 *
 * `magnitude` and `confidence` are separate and must stay separate. Magnitude is
 * *how much* — a message can be slightly or overwhelmingly urgent. Confidence is
 * *how sure* — whether it is urgent at all. They come apart constantly: a single
 * hedged phrase is weak evidence of strong frustration, and collapsing the two
 * would report that as mild frustration, which is a different and wrong claim.
 */
export interface Observation {
  readonly dimension: ObservationDimension;
  readonly family: ObservationFamily;
  readonly stance: ObservationStance;
  /** Which channel noticed it. Never merged across channels. */
  readonly channel: PerceptChannel;
  /** How much of it, 0–1. */
  readonly magnitude: number;
  /**
   * How sure, 0–1.
   *
   * **Computed from this observation's own evidence and nothing else.** No
   * observation may raise or lower another's confidence — not a corroborating
   * one from the same channel, not a concurring one from a different channel.
   * Two channels that agree produce two observations, and what to make of the
   * agreement is the reader's decision, not perception's. Borrowing confidence
   * is how three weak guesses become one confident claim about someone's inner
   * state, which is the exact failure this engine exists to avoid.
   */
  readonly confidence: ConfidenceScore;
  /** Why. Never empty. */
  readonly evidence: readonly ObservationEvidence[];
  /** When the percept this came from was captured. */
  readonly at: Timestamp;
}

/** Why nothing was observed on a dimension. */
export type UnknownReason =
  /** The channels supplied could speak to it and did not. Silence is this. */
  | 'no_evidence'
  /** No supplied channel can speak to it at all. */
  | 'no_channel'
  /** There was input, but not enough of it to measure. */
  | 'insufficient_input';

export const UNKNOWN_REASONS = [
  'no_evidence',
  'no_channel',
  'insufficient_input',
] as const satisfies readonly UnknownReason[];

/**
 * A dimension that was looked for and not found.
 *
 * Reported rather than left to absence, and the reason matters more than the
 * fact. A companion that knows the user's face was not visible behaves
 * differently from one that knows the face was visible and showed nothing — and
 * a missing key in a map cannot tell those apart.
 */
export interface UnknownDimension {
  readonly dimension: ObservationDimension;
  readonly family: ObservationFamily;
  readonly reason: UnknownReason;
  readonly detail: string;
}

/**
 * Two observations that sit oddly together.
 *
 * Reported, never resolved. People are agreeable and annoyed at once, excited
 * and exhausted at once, certain about one thing while hedging another. An
 * engine that picked a winner would be inventing a coherence the interaction did
 * not have — so both observations stand at their own confidence and the tension
 * between them becomes a third thing the caller can read.
 */
export interface Tension {
  readonly dimensions: readonly [ObservationDimension, ObservationDimension];
  readonly detail: string;
}

/**
 * A thing the message pointed at.
 *
 * Not an observation: a reference is something in the world the user named, not
 * a reading of the user's state. Retrieval wants these as entities; nothing
 * about them says anything about the person, which is why they are kept out of
 * the dimension vocabulary entirely.
 */
export interface Reference {
  readonly text: string;
  readonly kind: 'capitalised' | 'quoted' | 'repeated';
}

export type PerceptionReasonCode =
  | 'channel_examined'
  | 'channel_unavailable'
  | 'extractor_ran'
  | 'no_extractor'
  | 'input_empty'
  | 'observation_made'
  | 'tension_found';

export const PERCEPTION_REASON_CODES = [
  'channel_examined',
  'channel_unavailable',
  'extractor_ran',
  'no_extractor',
  'input_empty',
  'observation_made',
  'tension_found',
] as const satisfies readonly PerceptionReasonCode[];

export interface PerceptionReason {
  readonly code: PerceptionReasonCode;
  readonly detail: string;
}

/**
 * Everything one perception pass noticed.
 *
 * Deliberately not a summary. There is no "primary emotion", no overall mood, no
 * single intent — those are interpretations, and every one of them is a decision
 * some other engine is better placed to make with more context than perception
 * has. What is here is the raw set of readings, each standing on its own
 * evidence, plus an honest account of what could not be seen.
 */
export interface PerceptionOutcome {
  readonly observations: readonly Observation[];
  /** Dimensions examined and not found, with why. */
  readonly unknown: readonly UnknownDimension[];
  readonly tensions: readonly Tension[];
  readonly references: readonly Reference[];
  /** Channels that were supplied, in the order declared. */
  readonly channels: readonly PerceptChannel[];
  readonly reasons: readonly PerceptionReason[];
  /** The moment perceived. Never a clock reading. */
  readonly at: Timestamp;
}
