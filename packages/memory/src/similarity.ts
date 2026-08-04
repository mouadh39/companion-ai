import type { Memory, MemoryProposal } from '@nexa/models';

/**
 * How alike two pieces of text are, deterministically and without embeddings.
 *
 * **This is a lexical overlap measure, and its limits are the point.** It
 * catches restatements that share vocabulary — "I prefer short answers" against
 * "I prefer shorter answers" — and it cannot catch a paraphrase that does not.
 * "I'm vegetarian" and "I don't eat meat" score near zero here and are the same
 * fact.
 *
 * That gap is accepted deliberately rather than papered over. Closing it needs
 * semantic comparison, which needs embeddings, which this engine may not do. So
 * the engine is built to be *conservative under uncertainty*: an undetected
 * duplicate becomes a second memory, which retrieval will surface alongside the
 * first and reflection can later merge. A false duplicate would silently
 * discard something true, which is much worse and much harder to notice.
 *
 * Everything here is pure and order-independent, so the same pair always scores
 * the same in either direction — a similarity that depended on argument order
 * would make deduplication depend on iteration order.
 */

/**
 * Words too common to carry meaning.
 *
 * Small on purpose. An aggressive stop list would strip "not", and "I like
 * coffee" versus "I do not like coffee" would become identical — turning a
 * contradiction into a duplicate, which is exactly the case conflict detection
 * exists to catch.
 */
const STOP_WORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been',
  'to', 'of', 'in', 'on', 'at', 'for', 'with', 'and', 'or',
  'that', 'this', 'it', 'as', 'my', 'me', 'i',
]);

/**
 * Crude, consistent suffix normalisation.
 *
 * Not a stemmer and not trying to be one. It exists so that "short" and
 * "shorter", or "answer" and "answers", are treated as the same word — the
 * single most common way a restatement fails to match on raw tokens.
 *
 * Consistency matters more than linguistic correctness here: "answers" and
 * "answer" both reducing to "answ" is fine, because nothing reads the output
 * except a set comparison. What would *not* be fine is one of them reducing and
 * the other not, so the plural is stripped before the comparative and each rule
 * is applied at most once.
 *
 * Short words are left alone. Stripping suffixes from three-letter words turns
 * distinct terms into collisions, and "not" surviving intact is what lets
 * negation detection work at all.
 */
const normalise = (word: string): string => {
  let stem = word;
  if (stem.length > 4 && stem.endsWith('s') && !stem.endsWith('ss')) {
    stem = stem.slice(0, -1);
  }
  if (stem.length > 4 && stem.endsWith('er')) {
    stem = stem.slice(0, -2);
  }
  return stem;
};

/** Content words, lowercased, de-punctuated and suffix-normalised. */
export const tokenize = (text: string): readonly string[] =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/u)
    .filter((word) => word.length > 0 && !STOP_WORDS.has(word))
    .map(normalise);

/**
 * Jaccard overlap of the content words, 0–1.
 *
 * Set-based rather than sequence-based because word order carries little here:
 * "coffee I prefer black" and "I prefer black coffee" are the same claim, and a
 * sequence measure would rank them apart.
 */
export const similarity = (left: string, right: string): number => {
  const a = new Set(tokenize(left));
  const b = new Set(tokenize(right));

  if (a.size === 0 || b.size === 0) return 0;

  let shared = 0;
  for (const word of a) if (b.has(word)) shared++;

  const union = a.size + b.size - shared;
  return union === 0 ? 0 : round(shared / union);
};

/** Above this, two texts are treated as restating one fact. */
export const DUPLICATE_THRESHOLD = 0.75;

/**
 * Above this, two texts are *about* the same thing without restating it.
 *
 * The band between this and `DUPLICATE_THRESHOLD` is where conflict lives: high
 * overlap but not identical usually means the same subject with a different
 * claim — "I prefer tea" against "I prefer coffee" shares most of its words and
 * contradicts.
 */
export const RELATED_THRESHOLD = 0.45;

/**
 * Words that flip a claim.
 *
 * Checked separately from overlap because negation is precisely what token
 * similarity is blind to: "I like mornings" and "I don't like mornings" share
 * every content word. Two otherwise-similar texts that disagree on negation are
 * a conflict, not a duplicate.
 */
const NEGATIONS = new Set(['not', "don't", 'dont', 'never', 'no', 'stopped', 'quit']);

export const negates = (text: string): boolean => {
  const words = text.toLowerCase().replace(/[^\p{L}\p{N}\s']/gu, ' ').split(/\s+/u);
  return words.some((word) => NEGATIONS.has(word));
};

/** How a proposal relates to an existing memory. */
export type Relatedness = 'duplicate' | 'conflict' | 'related' | 'unrelated';

/**
 * Classifies a proposal against one stored memory.
 *
 * Only compares memories with the *same subject*. Two facts about different
 * parts of a life are not duplicates however much vocabulary they share, and
 * comparing across subjects is how "I work in a hospital" comes to supersede
 * "my sister works in a hospital".
 */
export const relatednessTo = (
  proposal: MemoryProposal,
  subject: Memory['subject'],
  memory: Memory,
): Relatedness => {
  if (memory.subject !== subject) return 'unrelated';

  const overlap = similarity(proposal.content, memory.content);
  if (overlap < RELATED_THRESHOLD) return 'unrelated';

  // Disagreement on negation outranks raw overlap. Two texts that share every
  // word but one of them is "not" are the clearest conflict available.
  if (negates(proposal.content) !== negates(memory.content)) return 'conflict';

  if (overlap >= DUPLICATE_THRESHOLD) return 'duplicate';
  return 'related';
};

const round = (value: number): number => Math.round(value * 1_000) / 1_000;
