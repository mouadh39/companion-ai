import type { ObservationDimension, TextPercept } from '@nexa/models';
import type { RawSignal, SignalExtractor } from '../registry.js';
import { asChannel } from '../registry.js';
import {
  CERTAINTY_PHRASES,
  HEDGE_PHRASES,
  URGENCY_PHRASES,
  evidence,
  excerptAround,
  matches,
  padded,
} from './lexicon.js';

/**
 * How the message was written, as measurement rather than inference.
 *
 * Almost everything here is `observed`, and that is not the engine being
 * generous with itself. The length of a message is a fact about the message; so
 * is how many hedges are in it. These are readings of an artefact, not guesses
 * about a person — which is exactly the line the stance vocabulary draws.
 *
 * The one thing that stays `possible` is urgency inferred from typography.
 * Capital letters and a row of exclamation marks are how *some* people write
 * when something is on fire and how others write all the time, and the engine
 * has no way to tell which without knowing the person.
 */

/** Words, not characters: a long word does not make a message verbose. */
const wordCount = (text: string): number =>
  text.trim().length === 0 ? 0 : text.trim().split(/\s+/u).length;

/**
 * Where "brief" stops and "verbose" begins.
 *
 * A scale rather than a threshold. Verbosity is reported as a magnitude on every
 * message with words in it, because the caller asking "how much is this person
 * saying?" wants the number, not a bucket someone else chose.
 */
export const VERBOSITY_SATURATION_WORDS = 120;

/** Below this, there is not enough text to measure anything about its style. */
export const MIN_WORDS_FOR_STYLE = 3;

const verbositySignal = (text: string): readonly RawSignal[] => {
  const words = wordCount(text);
  if (words === 0) return [];

  return [
    {
      dimension: 'verbosity',
      stance: 'observed',
      magnitude: Math.min(1, words / VERBOSITY_SATURATION_WORDS),
      evidence: [
        evidence('structural', 'word_count', `${words} words`, 0.9),
      ],
    },
  ];
};

/**
 * Directness, as the balance of commitment against hedging.
 *
 * Reported only when there is enough text to have a style at all. A three-word
 * message is not direct or indirect; it is short, and `verbosity` already said
 * so. Scoring it anyway would put a confident reading on the thinnest possible
 * evidence, which is the failure mode this family is most prone to.
 */
const directnessSignal = (text: string): readonly RawSignal[] => {
  const words = wordCount(text);
  if (words < MIN_WORDS_FOR_STYLE) return [];

  const haystack = padded(text);
  const hedges = matches(haystack, HEDGE_PHRASES);
  const commitments = matches(haystack, CERTAINTY_PHRASES);
  const imperative = /^(?:please\s+)?(?:make|write|build|fix|show|give|tell|add|remove|explain)\b/iu.test(
    text.trim(),
  );

  if (hedges.length === 0 && commitments.length === 0 && !imperative) return [];

  const lean = commitments.length + (imperative ? 1 : 0) - hedges.length;

  return [
    {
      dimension: 'directness',
      stance: 'observed',
      // Centred on 0.5, so a message that hedges as much as it commits reads as
      // neither direct nor indirect rather than as mildly direct.
      magnitude: 0.5 + Math.max(-0.5, Math.min(0.5, lean * 0.2)),
      evidence: [
        ...commitments.map((phrase) =>
          evidence('phrase', phrase, excerptAround(text, phrase)),
        ),
        ...hedges.map((phrase) => evidence('phrase', phrase, excerptAround(text, phrase))),
        ...(imperative
          ? [evidence('structural', 'imperative_opening', text.trim().slice(0, 40), 0.65)]
          : []),
      ],
    },
  ];
};

/**
 * Hedging, read two ways at once.
 *
 * The same phrase is evidence of two different things and both are reported.
 * "I guess" says something about the *claim* — it is offered tentatively — and
 * something about the *speaker* — they are hesitating. A single dimension would
 * force a choice between the two, and the consumers differ: generation wants to
 * know how firmly to treat the claim, expression wants to know whether to slow
 * down.
 *
 * They are separate observations with separate evidence, so neither borrows the
 * other's confidence even though they rest on the same words.
 */
const hedgeSignals = (text: string): readonly RawSignal[] => {
  const haystack = padded(text);
  const hedges = matches(haystack, HEDGE_PHRASES);
  const commitments = matches(haystack, CERTAINTY_PHRASES);
  const signals: RawSignal[] = [];

  if (hedges.length > 0) {
    const cues = hedges.map((phrase) => evidence('phrase', phrase, excerptAround(text, phrase)));

    signals.push({
      dimension: 'uncertainty',
      stance: 'observed',
      magnitude: Math.min(1, 0.4 + 0.2 * hedges.length),
      evidence: cues,
    });
    signals.push({
      dimension: 'hesitation',
      stance: 'observed',
      magnitude: Math.min(1, 0.4 + 0.2 * hedges.length),
      evidence: cues,
    });
  }

  if (commitments.length > 0) {
    signals.push({
      dimension: 'certainty',
      stance: 'observed',
      magnitude: Math.min(1, 0.5 + 0.2 * commitments.length),
      evidence: commitments.map((phrase) =>
        evidence('phrase', phrase, excerptAround(text, phrase)),
      ),
    });
  }

  return signals;
};

/** Typographic shouting, which may mean urgency and may mean a stuck caps lock. */
const isShouting = (text: string): boolean => {
  const letters = text.replace(/[^\p{L}]/gu, '');
  if (letters.length < 8) return false;
  return letters === letters.toUpperCase();
};

const urgencySignals = (text: string): readonly RawSignal[] => {
  const haystack = padded(text);
  const stated = matches(haystack, URGENCY_PHRASES);
  const signals: RawSignal[] = [];

  if (stated.length > 0) {
    signals.push({
      dimension: 'urgency',
      stance: 'observed',
      magnitude: Math.min(1, 0.6 + 0.2 * stated.length),
      evidence: stated.map((phrase) => evidence('phrase', phrase, excerptAround(text, phrase))),
    });
  }

  const shouting = isShouting(text);
  const bangs = (text.match(/!/gu) ?? []).length;

  if (shouting || bangs >= 2) {
    // Possible, never observed, and separate from the stated one above. Some
    // people type in capitals; a companion that read every such message as an
    // emergency would be wrong about the same person every day.
    signals.push({
      dimension: 'urgency',
      stance: 'possible',
      magnitude: 0.6,
      evidence: [
        ...(shouting ? [evidence('structural', 'all_caps', text.slice(0, 40), 0.5)] : []),
        ...(bangs >= 2
          ? [evidence('structural', 'repeated_exclamation', `${bangs} exclamation marks`, 0.45)]
          : []),
      ],
    });
  }

  return signals;
};

const DIMENSIONS: readonly ObservationDimension[] = [
  'verbosity',
  'directness',
  'uncertainty',
  'certainty',
  'hesitation',
  'urgency',
];

export const textCommunicationExtractor: SignalExtractor = {
  id: 'text.communication',
  channel: 'text',
  dimensions: DIMENSIONS,
  extract: (percept) => {
    const text = asChannel<TextPercept>(percept, 'text');
    if (text === null || text.text.trim().length === 0) return [];

    return [
      ...verbositySignal(text.text),
      ...directnessSignal(text.text),
      ...hedgeSignals(text.text),
      ...urgencySignals(text.text),
    ];
  },
};
