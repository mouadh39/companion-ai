import type { ObservationDimension, TextPercept } from '@nexa/models';
import type { ExtractionContext, RawSignal, SignalExtractor } from '../registry.js';
import { asChannel } from '../registry.js';
import {
  AGREEMENT_PHRASES,
  CORRECTION_PHRASES,
  DISAGREEMENT_PHRASES,
  FAREWELL_PHRASES,
  GREETING_PHRASES,
  QUESTION_OPENERS,
  SOFT_CORRECTION_PHRASES,
  evidence,
  excerptAround,
  matches,
  padded,
} from './lexicon.js';

/**
 * What this turn is doing to the conversation.
 *
 * The most confidently observable family, because most of it is structural. A
 * question mark *is* a question; "hello" *is* a greeting. There is no inference
 * between the evidence and the claim, so the ceilings are the highest in the
 * table and nearly everything here is `observed`.
 *
 * Two exceptions earn their softer treatment:
 *
 * - **A soft correction.** "Actually," precedes a correction about as often as
 *   it precedes an anecdote.
 * - **A topic shift.** It is measured against the previous turns, and a message
 *   sharing no vocabulary with what came before may be a new subject or may be
 *   the same subject in different words.
 */

/** Below this overlap with the recent conversation, the subject may have changed. */
export const TOPIC_OVERLAP_FLOOR = 0.15;

/** How many previous turns count as "what we were talking about". */
export const TOPIC_WINDOW = 4;

/** Too short to tell a new subject from a continuation. "ok" shifts nothing. */
export const MIN_WORDS_FOR_TOPIC_SHIFT = 4;

const contentWords = (text: string): ReadonlySet<string> =>
  new Set(
    text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/u)
      .filter((word) => word.length > 3),
  );

/**
 * Questions, from the punctuation and from the opening.
 *
 * A question mark **anywhere** counts, not only at the end. "Is the build green?
 * I'm so frustrated!" is a question followed by a complaint, and an end-anchored
 * check reads it as neither — losing the one part of the message the companion
 * is actually being asked to answer. Terminal marks score higher, because a
 * message that ends on its question is more squarely a request for an answer
 * than one that asks and moves on.
 */
const questionSignals = (text: string): readonly RawSignal[] => {
  const trimmed = text.trim();
  const haystack = padded(text);
  const terminal = trimmed.endsWith('?');
  const marks = (trimmed.match(/\?/gu) ?? []).length;
  const opener = QUESTION_OPENERS.filter((word) => haystack.startsWith(` ${word} `));

  if (marks === 0 && opener.length === 0) return [];

  return [
    {
      dimension: 'question',
      stance: 'observed',
      magnitude: terminal ? 0.9 : marks > 0 ? 0.7 : 0.6,
      evidence: [
        ...(marks > 0
          ? [
              evidence(
                'structural',
                terminal ? 'question_mark' : 'question_mark_mid_message',
                terminal ? trimmed.slice(-40) : trimmed.slice(0, 40),
                terminal ? 0.9 : 0.75,
              ),
            ]
          : []),
        ...opener.map((word) => evidence('phrase', word, trimmed.slice(0, 40), 0.6)),
      ],
    },
  ];
};

const correctionSignals = (text: string): readonly RawSignal[] => {
  const haystack = padded(text);
  const explicit = matches(haystack, CORRECTION_PHRASES);
  const soft = matches(haystack, SOFT_CORRECTION_PHRASES);
  const signals: RawSignal[] = [];

  if (explicit.length > 0) {
    signals.push({
      dimension: 'correction',
      stance: 'observed',
      magnitude: 0.8,
      evidence: explicit.map((phrase) =>
        evidence('phrase', phrase, excerptAround(text, phrase), 0.8),
      ),
    });
    return signals;
  }

  if (soft.length > 0) {
    signals.push({
      dimension: 'correction',
      stance: 'possible',
      magnitude: 0.5,
      evidence: soft.map((phrase) => evidence('phrase', phrase, excerptAround(text, phrase), 0.45)),
    });
  }

  return signals;
};

const stanceSignals = (text: string): readonly RawSignal[] => {
  const haystack = padded(text);
  const agreeing = matches(haystack, AGREEMENT_PHRASES);
  const disagreeing = matches(haystack, DISAGREEMENT_PHRASES);
  const signals: RawSignal[] = [];

  // Both are reported when both are present. "Yes, but I don't think that
  // works" is genuinely both, and picking one would discard the half the
  // tie-break happened to dislike. The tension between them is reported
  // separately; neither is suppressed and neither is weakened.
  if (agreeing.length > 0) {
    signals.push({
      dimension: 'agreement',
      stance: 'observed',
      magnitude: Math.min(1, 0.5 + 0.2 * agreeing.length),
      evidence: agreeing.map((phrase) => evidence('phrase', phrase, excerptAround(text, phrase))),
    });
  }

  if (disagreeing.length > 0) {
    signals.push({
      dimension: 'disagreement',
      stance: 'observed',
      magnitude: Math.min(1, 0.5 + 0.2 * disagreeing.length),
      evidence: disagreeing.map((phrase) =>
        evidence('phrase', phrase, excerptAround(text, phrase)),
      ),
    });
  }

  return signals;
};

const socialSignals = (text: string): readonly RawSignal[] => {
  const haystack = padded(text);
  const signals: RawSignal[] = [];

  const greetings = GREETING_PHRASES.filter((phrase) => haystack.startsWith(` ${phrase} `) || haystack.trim() === phrase);
  if (greetings.length > 0) {
    signals.push({
      dimension: 'greeting',
      stance: 'observed',
      magnitude: 0.8,
      evidence: greetings.map((phrase) => evidence('phrase', phrase, text.trim().slice(0, 40), 0.8)),
    });
  }

  const farewells = matches(haystack, FAREWELL_PHRASES);
  if (farewells.length > 0) {
    signals.push({
      dimension: 'farewell',
      stance: 'observed',
      magnitude: 0.8,
      evidence: farewells.map((phrase) =>
        evidence('phrase', phrase, excerptAround(text, phrase), 0.8),
      ),
    });
  }

  return signals;
};

/**
 * Whether the subject changed, measured against the turns before it.
 *
 * The only text signal that needs context, and the only one that can report
 * nothing on a first turn — a message cannot shift a topic that does not exist
 * yet. Reporting one anyway would be the engine inventing a conversation.
 */
const topicShiftSignal = (
  text: string,
  context: ExtractionContext,
): readonly RawSignal[] => {
  const recent = context.conversation.slice(-TOPIC_WINDOW);
  if (recent.length === 0) return [];

  const words = text.trim().split(/\s+/u).filter((word) => word.length > 0);
  if (words.length < MIN_WORDS_FOR_TOPIC_SHIFT) return [];

  const now = contentWords(text);
  const before = contentWords(recent.map((turn) => turn.content).join(' '));
  if (now.size === 0 || before.size === 0) return [];

  let shared = 0;
  for (const word of now) if (before.has(word)) shared++;
  const overlap = shared / now.size;

  if (overlap > TOPIC_OVERLAP_FLOOR) return [];

  return [
    {
      dimension: 'topic_shift',
      // Possible, not observed. A message sharing no vocabulary with what came
      // before may be a new subject, or the same subject in different words —
      // and a synonym is invisible to a word-overlap measure.
      stance: 'possible',
      magnitude: 1 - overlap,
      evidence: [
        evidence(
          'contextual',
          'low_overlap_with_recent_turns',
          `${Math.round(overlap * 100)}% word overlap with the last ${recent.length} turn(s)`,
          0.5,
        ),
      ],
    },
  ];
};

const DIMENSIONS: readonly ObservationDimension[] = [
  'topic_shift',
  'correction',
  'question',
  'agreement',
  'disagreement',
  'greeting',
  'farewell',
];

export const textConversationExtractor: SignalExtractor = {
  id: 'text.conversation',
  channel: 'text',
  dimensions: DIMENSIONS,
  extract: (percept, context) => {
    const text = asChannel<TextPercept>(percept, 'text');
    if (text === null || text.text.trim().length === 0) return [];

    return [
      ...questionSignals(text.text),
      ...correctionSignals(text.text),
      ...stanceSignals(text.text),
      ...socialSignals(text.text),
      ...topicShiftSignal(text.text, context),
    ];
  },
};
