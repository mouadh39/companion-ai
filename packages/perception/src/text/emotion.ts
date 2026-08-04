import type { ObservationDimension, TextPercept } from '@nexa/models';
import type { RawSignal, SignalExtractor } from '../registry.js';
import { asChannel } from '../registry.js';
import {
  EMOTION_WORDS,
  NEGATIVE_OUTCOME_PHRASES,
  SELF_REPORT_PREFIXES,
  evidence,
  excerptAround,
  matches,
  padded,
} from './lexicon.js';

/**
 * Emotional readings from text, and the line between stating and suggesting.
 *
 * This extractor is where the brief's central example lives:
 *
 * ```
 *   "I am frustrated."        → observed   — they said so
 *   "I guess nothing works."  → possible   — something went badly; they did not say how they feel
 *   ""                        → unknown    — nothing to read
 * ```
 *
 * The whole difference is whether the emotion word is attached to the person.
 * "I am frustrated" and "this is frustrating" share a stem and differ by the
 * only thing that matters: one is a person describing themselves and the other
 * is a person describing a compiler. Treating them alike is how a companion ends
 * up consoling someone who was merely annoyed at a build system.
 *
 * ## Every emotion found is reported
 *
 * There is no primary emotion and no winner. Someone can be pleased and
 * exhausted in one sentence, and forcing a single label would discard whichever
 * half the tie-break disliked. Conflicts between them are reported separately as
 * tensions; nothing here resolves anything.
 */

/** How much of the emotion, absent any word saying how much. */
const DEFAULT_MAGNITUDE = 0.7;

/** Intensifiers, and what they do to magnitude — never to confidence. */
const INTENSIFIERS: readonly string[] = [
  'so', 'really', 'very', 'extremely', 'incredibly', 'utterly', 'completely',
  'totally', 'absolutely', 'beyond',
];

/** Diminishers. The same lever in the other direction. */
const DIMINISHERS: readonly string[] = ['a bit', 'a little', 'slightly', 'somewhat', 'mildly'];

/**
 * Adverbs that may sit between "I am" and the feeling.
 *
 * "I am also miserable" and "I am still frustrated" are self-reports with a word
 * in the middle, and an adjacency check that missed them would push some of the
 * plainest statements a person can make down to `possible`. The list is closed
 * and short: anything not on it breaks the adjacency, which is what keeps "I am
 * fine but the deploy was frustrating" out.
 */
const INTERVENING_ADVERBS: readonly string[] = [
  'so', 'really', 'very', 'extremely', 'incredibly', 'utterly', 'completely',
  'totally', 'absolutely', 'beyond', 'slightly', 'somewhat', 'mildly',
  'also', 'still', 'just', 'always', 'often', 'currently', 'now',
  'honestly', 'genuinely', 'a bit', 'a little', 'kind of', 'sort of',
];

/**
 * Whether an emotion word is being said of the speaker.
 *
 * Looks only immediately to the left of the word, past any intervening adverb. A
 * wider window would catch "I am fine but the deploy was frustrating" as a
 * self-report, which is the one sentence shape most likely to be misread —
 * someone explicitly saying they are *not* upset while describing something that
 * is.
 */
const isSelfReported = (haystack: string, word: string): boolean => {
  const index = haystack.indexOf(word);
  if (index < 0) return false;

  let before = haystack.slice(Math.max(0, index - 32), index).trimEnd();

  // Strip adverbs one at a time, bounded, so "I am really quite frustrated"
  // resolves without an unbounded loop over adversarial input.
  for (let step = 0; step < 3; step++) {
    const adverb = INTERVENING_ADVERBS.find((word_) => before.endsWith(` ${word_}`));
    if (adverb === undefined) break;
    before = before.slice(0, before.length - adverb.length).trimEnd();
  }

  return SELF_REPORT_PREFIXES.some((prefix) => before.endsWith(prefix));
};

/**
 * How much, from the words around the emotion.
 *
 * Magnitude only. An intensifier tells you the feeling is large; it tells you
 * nothing about whether you have read the situation correctly, so it must not
 * touch confidence. Letting "so" raise certainty is precisely the borrowing this
 * engine forbids, arriving through the back door of a single observation.
 */
const magnitudeFor = (haystack: string, word: string): number => {
  const index = haystack.indexOf(word);
  const before = index < 0 ? '' : haystack.slice(Math.max(0, index - 24), index);

  if (INTENSIFIERS.some((cue) => before.includes(` ${cue} `))) return 0.9;
  if (DIMINISHERS.some((cue) => before.includes(cue))) return 0.4;
  return DEFAULT_MAGNITUDE;
};

const emotionSignals = (text: string): readonly RawSignal[] => {
  const haystack = padded(text);
  const signals: RawSignal[] = [];

  for (const [dimension, words] of EMOTION_WORDS) {
    const found = matches(haystack, words);
    if (found.length === 0) continue;

    // Split rather than merged. A message that both states an emotion and
    // mentions it in passing produces one strong observation, not one blurred
    // one — the passing mention corroborates the self-report it belongs to and
    // never props up a separate inference.
    const stated = found.filter((word) => isSelfReported(haystack, word));
    const mentioned = found.filter((word) => !isSelfReported(haystack, word));

    if (stated.length > 0) {
      signals.push({
        dimension,
        stance: 'observed',
        magnitude: Math.max(...stated.map((word) => magnitudeFor(haystack, word))),
        evidence: [
          ...stated.map((word) =>
            evidence('self_report', word, excerptAround(text, word)),
          ),
          ...mentioned.map((word) => evidence('phrase', word, excerptAround(text, word))),
        ],
      });
      continue;
    }

    signals.push({
      dimension,
      stance: 'possible',
      // Read the same way as a stated one, and that is the point of keeping
      // magnitude and confidence apart. "This is so frustrating" describes a
      // large frustration on weak evidence that the person holds it — high
      // magnitude, low confidence. Flattening the magnitude here would report
      // it as mild frustration, which is a third claim the message does not
      // make.
      magnitude: Math.max(...mentioned.map((word) => magnitudeFor(haystack, word))),
      evidence: mentioned.map((word) => evidence('phrase', word, excerptAround(text, word))),
    });
  }

  return signals;
};

/**
 * Frustration inferred from things having gone badly.
 *
 * Always `possible`, without exception. "Nothing works" is a report about the
 * world; reading it as a report about a person is an inference, however obvious
 * it feels — and the engine's licence to make obvious inferences is exactly what
 * would let it make less obvious ones.
 */
const outcomeSignals = (text: string): readonly RawSignal[] => {
  const haystack = padded(text);
  const found = matches(haystack, NEGATIVE_OUTCOME_PHRASES);
  if (found.length === 0) return [];

  return [
    {
      dimension: 'frustration',
      stance: 'possible',
      magnitude: 0.5,
      evidence: found.map((phrase) =>
        // Weaker than an ordinary phrase match. This is not even a word about
        // feelings — it is a word about a build, and the leap to a person is
        // one the number should show.
        evidence('phrase', phrase, excerptAround(text, phrase), 0.45),
      ),
    },
  ];
};

const DIMENSIONS: readonly ObservationDimension[] = [
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
];

export const textEmotionExtractor: SignalExtractor = {
  id: 'text.emotion',
  channel: 'text',
  dimensions: DIMENSIONS,
  extract: (percept) => {
    const text = asChannel<TextPercept>(percept, 'text');
    if (text === null || text.text.trim().length === 0) return [];

    return [...emotionSignals(text.text), ...outcomeSignals(text.text)];
  },
};
