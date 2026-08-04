import type { ObservationDimension, Reference, TextPercept } from '@nexa/models';
import type { RawSignal, SignalExtractor } from '../registry.js';
import { asChannel } from '../registry.js';
import {
  BRAINSTORM_PHRASES,
  CASUAL_PHRASES,
  HELP_REQUEST_PHRASES,
  LEARNING_PHRASES,
  PLANNING_PHRASES,
  REFLECTION_PHRASES,
  evidence,
  excerptAround,
  matches,
  padded,
} from './lexicon.js';

/**
 * What the user appears to want from the exchange.
 *
 * The family closest to interpretation, and the one held most carefully because
 * of it. Every dimension here is `observed` — the phrases are what was said —
 * but nothing in this file decides *which* of them the turn is really about.
 * A message can ask for help, plan, and be learning something all at once, and
 * all three are reported.
 *
 * That restraint is the point of the layering. Picking a single intent is a
 * decision, decisions belong to planning, and a perception engine that quietly
 * made one would be a planner with a modest name.
 */

const family = (
  dimension: ObservationDimension,
  phrases: readonly string[],
  text: string,
  base: number,
): readonly RawSignal[] => {
  const found = matches(padded(text), phrases);
  if (found.length === 0) return [];

  return [
    {
      dimension,
      stance: 'observed',
      magnitude: Math.min(1, base + 0.15 * (found.length - 1)),
      evidence: found.map((phrase) => evidence('phrase', phrase, excerptAround(text, phrase))),
    },
  ];
};

const DIMENSIONS: readonly ObservationDimension[] = [
  'help_request',
  'planning',
  'reflection',
  'brainstorming',
  'learning',
  'casual',
];

export const textInteractionExtractor: SignalExtractor = {
  id: 'text.interaction',
  channel: 'text',
  dimensions: DIMENSIONS,
  extract: (percept) => {
    const text = asChannel<TextPercept>(percept, 'text');
    if (text === null || text.text.trim().length === 0) return [];

    const body = text.text;
    return [
      ...family('help_request', HELP_REQUEST_PHRASES, body, 0.6),
      ...family('planning', PLANNING_PHRASES, body, 0.55),
      ...family('reflection', REFLECTION_PHRASES, body, 0.6),
      ...family('brainstorming', BRAINSTORM_PHRASES, body, 0.55),
      ...family('learning', LEARNING_PHRASES, body, 0.55),
      ...family('casual', CASUAL_PHRASES, body, 0.6),
    ];
  },
};

/**
 * Things the message named.
 *
 * Not observations, and kept deliberately outside the dimension vocabulary. A
 * reference is something *in the world* the user pointed at; every dimension is
 * a reading of the user. Mixing them would let "she mentioned Unity" be scored
 * for confidence and magnitude alongside "she may be frustrated", as though they
 * were the same kind of claim about the same kind of thing.
 *
 * Capitalised words and quoted spans, which is a placeholder for real entity
 * recognition and says so. It is honest about being shallow rather than
 * pretending to a capability the engine does not have.
 */
export const referencesIn = (text: string, limit: number): readonly Reference[] => {
  const seen = new Set<string>();
  const references: Reference[] = [];

  const add = (value: string, kind: Reference['kind']): void => {
    const key = value.toLowerCase();
    if (seen.has(key) || references.length >= limit) return;
    seen.add(key);
    references.push({ text: value, kind });
  };

  // Sentence-initial words are skipped: every sentence starts with a capital,
  // so counting them would make "The" the most referenced entity in the corpus.
  for (const match of text.matchAll(/(?<![.!?]\s|^)\b[A-Z][a-zA-Z0-9_.-]{2,}\b/gu)) {
    const value = match[0];
    if (value !== undefined) add(value, 'capitalised');
  }

  for (const match of text.matchAll(/"([^"]{2,60})"/gu)) {
    const value = match[1];
    if (value !== undefined) add(value, 'quoted');
  }

  return references;
};
