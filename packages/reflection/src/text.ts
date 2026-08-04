/**
 * Deterministic text handling, owned by this engine.
 *
 * ## Why this is not shared with `@nexa/memory`
 *
 * `@nexa/memory` has a tokeniser and a Jaccard similarity that look like these
 * and are tuned for a different question. Memory asks *"is this proposal the
 * same fact as that stored memory?"* — a pairwise judgement where over-matching
 * discards something true. Reflection asks *"do these five remarks concern the
 * same thing?"* — a clustering judgement where over-matching invents a pattern.
 *
 * Sharing the code would couple the two tunings: widening memory's stemmer to
 * catch a missed duplicate would silently change which patterns reflection
 * discovers, in a package whose tests would not run. Two hundred lines
 * duplicated is a smaller cost than that, and the duplication is visible where a
 * coupling would not be. Extracting a `@nexa/text` package is the way out if a
 * third consumer appears; two is not enough to justify it.
 *
 * Everything here is pure, total and order-independent.
 */

/**
 * Words too common to be a topic.
 *
 * Larger than memory's list, because these tokens become *topic keys* — the
 * identity of a claim about a person. Memory can afford to let "very" through
 * as one word among many in an overlap ratio; here it would become the insight
 * "the user may enjoy very", which is the sort of output that destroys trust in
 * the whole engine at a glance.
 *
 * Negations are still absent, and for the same reason as in memory: stripping
 * "not" turns a contradiction into agreement, which is the one mistake this
 * list must not make.
 */
const STOP_WORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'am', 'do', 'does', 'did', 'have', 'has', 'had', 'will', 'would',
  'can', 'could', 'should', 'shall', 'may', 'might', 'must',
  'to', 'of', 'in', 'on', 'at', 'for', 'with', 'from', 'by', 'about',
  'and', 'or', 'but', 'if', 'so', 'than', 'then', 'that', 'this',
  'these', 'those', 'it', 'its', 'as', 'up', 'out', 'off', 'over',
  'i', 'me', 'my', 'mine', 'myself', 'we', 'us', 'our',
  'you', 'your', 'they', 'them', 'their', 'he', 'she', 'him', 'her',
  'very', 'really', 'just', 'quite', 'much', 'more', 'most', 'some',
  'any', 'all', 'lot', 'lots', 'bit', 'thing', 'things', 'stuff',
  'get', 'got', 'go', 'going', 'went', 'make', 'made', 'take', 'took',
  'when', 'where', 'what', 'which', 'who', 'how', 'why',
  'again', 'still', 'also', 'too', 'now', 'ever',
  // Contractions. Filtered here but *not* in `words`, which is what `negates`
  // reads — "don't" must never be a topic and must always be a negation.
  "i'm", "i've", "i'd", "i'll", "it's", "that's", "there's", "we're",
  "you're", "don't", "doesn't", "didn't", "can't", "won't", "isn't",
  "aren't", "wasn't", "hasn't", "haven't", "wouldn't", "couldn't",
]);

/**
 * Crude, consistent suffix reduction.
 *
 * Not a stemmer. It exists so "morning" and "mornings", or "explain" and
 * "explaining", land on one key — the commonest way two remarks about the same
 * thing fail to cluster.
 *
 * Order matters and each rule fires at most once, so reduction is idempotent:
 * `stem(stem(w)) === stem(w)` for every input. A stemmer that kept biting would
 * make a topic key depend on how many times it had been through the mill, and
 * two passes over the same memory would produce two different clusters.
 *
 * Short words are left alone. Stripping suffixes from four-letter words
 * collides distinct terms, and "not" surviving intact is what makes negation
 * detection work.
 */
export const stem = (word: string): string => {
  let reduced = word;

  // Plural first, then the verb endings. The other order is not equivalent and
  // is a live bug: "mornings" would reduce to "morning" while "morning" reduced
  // to "morn", so the singular and the plural would land in different clusters
  // and `stem` would stop being idempotent.
  if (reduced.length > 4 && reduced.endsWith('s') && !reduced.endsWith('ss')) {
    reduced = reduced.slice(0, -1);
  }
  if (reduced.length > 5 && reduced.endsWith('ing')) {
    reduced = reduced.slice(0, -3);
  } else if (reduced.length > 5 && reduced.endsWith('ed')) {
    reduced = reduced.slice(0, -2);
  }
  if (reduced.length > 4 && reduced.endsWith('er')) {
    reduced = reduced.slice(0, -2);
  }
  return reduced;
};

/** Lowercased words with punctuation removed. Nothing dropped, nothing reduced. */
export const words = (text: string): readonly string[] =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, ' ')
    .split(/\s+/u)
    .filter((word) => word.length > 0);

/**
 * One token per content word, carrying both its surface form and its stem.
 *
 * Both are kept because they answer different questions. The stem is the topic
 * *key* — machine identity, stable across "morning" and "mornings". The surface
 * form is what appears in a statement the user reads, and `stem` mangles words
 * enough ("answers" → "answ") that phrasing from it would be embarrassing.
 */
export interface Token {
  readonly surface: string;
  readonly key: string;
}

/**
 * Two-letter words survive.
 *
 * The usual minimum length of three would drop "VR", "AR", "AI" and "ML" — four
 * of the most topic-bearing words a user of this system is likely to say. The
 * noise that lets in is handled by the stop list, which is the right place for
 * it: a length rule cannot tell "so" from "AI".
 */
export const tokenize = (text: string): readonly Token[] =>
  words(text)
    .filter((word) => word.length > 1 && !STOP_WORDS.has(word))
    .map((word) => ({ surface: word, key: stem(word) }));

/**
 * Jaccard overlap of stems, 0–1.
 *
 * Used for exactly one thing: deciding whether two memories in the same cluster
 * are really the same remark. It is not used to *find* patterns — clustering
 * goes through explicit kind markers and an explicit theme table, because a
 * similarity threshold is a hidden heuristic and this engine is meant to be
 * understandable by reading it.
 */
export const similarity = (left: string, right: string): number => {
  const a = new Set(tokenize(left).map((token) => token.key));
  const b = new Set(tokenize(right).map((token) => token.key));

  if (a.size === 0 || b.size === 0) return 0;

  let shared = 0;
  for (const key of a) if (b.has(key)) shared++;

  const union = a.size + b.size - shared;
  return union === 0 ? 0 : round(shared / union);
};

/**
 * Words that flip a claim.
 *
 * Checked on the raw words rather than on tokens, because every one of these is
 * either a stop word or short enough that the stemmer leaves it alone — and a
 * negation that got filtered out before it was noticed is a denial recorded as
 * agreement.
 *
 * **Bare "no" is deliberately absent.** It negates a noun far more often than a
 * claim — "no sleep", "no time", "no problem" — and reading "I've had no sleep"
 * as a denial would turn the strongest evidence of overwork into evidence
 * against it. The cost of leaving it out is a missed denial, which produces no
 * insight; the cost of leaving it in is an inverted one, which produces a wrong
 * one. Those are not symmetrical.
 */
const NEGATIONS = new Set([
  'not', "don't", 'dont', "doesn't", 'doesnt', "didn't", 'didnt',
  "won't", 'wont', "can't", 'cant', 'cannot', 'never',
  'stopped', 'quit', 'dislike', 'hate', 'rarely', 'seldom',
]);

/** Negations that only read as negations across two words. */
const NEGATING_PHRASES = ['no longer', 'not any', 'used to'] as const;

export const negates = (text: string): boolean => {
  const spoken = words(text);
  if (spoken.some((word) => NEGATIONS.has(word))) return true;

  const joined = ` ${spoken.join(' ')} `;
  return NEGATING_PHRASES.some((phrase) => joined.includes(` ${phrase} `));
};

/**
 * Words dropped before a marker is looked for.
 *
 * Negation moves the words apart. "I enjoy chess" and "I do not enjoy chess"
 * are the same *kind* of claim pointing opposite ways, but the second contains
 * no adjacent "i enjoy" for a phrase matcher to find — so without this the
 * clearest contradiction a user can express produces no observation at all, and
 * an insight can be corroborated but never argued with.
 *
 * Eliding is safe precisely because polarity is read separately, from the
 * untouched text. This view exists only to answer "what sort of claim is this?"
 * — never "which way does it point?".
 *
 * Auxiliaries go too: dropping "not" from "I do not enjoy" leaves "I do enjoy",
 * which still does not contain the marker.
 */
const ELIDED = new Set([
  'not', "don't", 'dont', "doesn't", 'doesnt', "didn't", 'didnt',
  "can't", 'cant', 'cannot', "won't", 'wont', 'never', 'rarely', 'seldom',
  'do', 'does', 'did',
]);

/** The claim with its negation removed, spaced for phrase matching. */
export const withoutNegation = (text: string): string =>
  ` ${words(text)
    .filter((word) => !ELIDED.has(word))
    .join(' ')} `;

/** The claim as written, spaced for phrase matching. */
export const spaced = (text: string): string => ` ${words(text).join(' ')} `;

export const round = (value: number): number => Math.round(value * 1_000) / 1_000;
