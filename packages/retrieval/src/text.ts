/**
 * Lexical matching, owned by this engine.
 *
 * ## Why this is duplicated a third time
 *
 * `@nexa/memory` and `@nexa/reflection` each have a tokeniser that looks like
 * this, and each is tuned for a different question. Memory asks "is this
 * proposal the same fact as that stored one?" — over-matching discards something
 * true. Reflection asks "do these remarks concern the same thing?" —
 * over-matching invents a pattern. Retrieval asks "does this bear on what was
 * just said?" — over-matching wastes a slot, which is the cheapest of the three
 * failures and so licenses the loosest matching of the three.
 *
 * That is now three consumers, which is the threshold at which duplication stops
 * being cheaper than a shared package. **The right next step is to extract
 * `@nexa/text`** and have all three depend on it with their own tuning
 * constants. It is not done here because it would mean editing `@nexa/memory`
 * and `@nexa/reflection`, which this task is scoped out of. Recorded so the
 * decision is deliberate rather than forgotten.
 *
 * Everything here is pure, total, and order-independent.
 */

/**
 * Words that carry no topic.
 *
 * Sized for *query* terms, which is why it is the largest of the three lists. A
 * stop word that survives here becomes a term every candidate can match on, and
 * a match on "today" is a match that admits everything — which defeats the
 * relevance floor rather than merely blunting it.
 */
const STOP_WORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'am',
  'do', 'does', 'did', 'have', 'has', 'had', 'will', 'would', 'shall',
  'can', 'could', 'should', 'may', 'might', 'must', 'let',
  'to', 'of', 'in', 'on', 'at', 'for', 'with', 'from', 'by', 'about', 'into',
  'and', 'or', 'but', 'if', 'so', 'than', 'then', 'that', 'this', 'these',
  'those', 'it', 'its', 'as', 'up', 'out', 'off', 'over', 'under', 'again',
  'i', 'me', 'my', 'mine', 'myself', 'we', 'us', 'our', 'you', 'your',
  'they', 'them', 'their', 'he', 'she', 'him', 'her', 'his', 'hers',
  'very', 'really', 'just', 'quite', 'much', 'more', 'most', 'some', 'any',
  'all', 'lot', 'lots', 'bit', 'thing', 'things', 'stuff', 'kind', 'sort',
  'get', 'got', 'go', 'going', 'went', 'make', 'made', 'take', 'took', 'come',
  'when', 'where', 'what', 'which', 'who', 'how', 'why', 'here', 'there',
  'now', 'today', 'yesterday', 'tomorrow', 'still', 'also', 'too', 'ever',
  'like', 'well', 'okay', 'ok', 'yeah', 'yes', 'no', 'not', 'been',
  "i'm", "i've", "i'd", "i'll", "it's", "that's", "there's", "we're",
  "you're", "don't", "doesn't", "didn't", "can't", "won't", "isn't",
]);

/**
 * Crude, idempotent suffix reduction.
 *
 * Plural first, then the verb endings — the other order is not equivalent and is
 * a live bug: "mornings" would reduce to "morning" while "morning" reduced to
 * "morn", so a query and a memory that used different numbers of the same word
 * would land on different terms and never match.
 */
export const stem = (word: string): string => {
  let reduced = word;

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

/** Lowercased words, punctuation removed. Nothing dropped. */
export const words = (text: string): readonly string[] =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, ' ')
    .split(/\s+/u)
    .filter((word) => word.length > 0);

/**
 * Content-word stems, deduplicated, in order of appearance.
 *
 * Two-letter words survive the length filter, because "VR", "AR", "AI" and "ML"
 * are among the most topic-bearing things a user of this system says and a
 * length rule cannot tell them from "so". The stop list handles the noise, which
 * is the right place for it.
 */
export const terms = (text: string): readonly string[] => {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const word of words(text)) {
    if (word.length < 2 || STOP_WORDS.has(word)) continue;
    const key = stem(word);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }

  return out;
};

/**
 * How much of the *query* the text covers, 0–1.
 *
 * Deliberately **asymmetric**, and this is the one place retrieval's text
 * handling most differs from its siblings. Memory and reflection compare two
 * claims and want Jaccard, which is symmetric. Retrieval compares a short
 * question against a possibly long memory, and Jaccard punishes length: a
 * detailed memory that answers the question completely scores *lower* than a
 * terse one that answers it partly, purely for having more words. Coverage of
 * the query is what was actually asked.
 *
 * The length of the candidate is then ignored entirely, which is correct here —
 * how much else a memory says has no bearing on whether it speaks to this turn.
 */
export const coverage = (queryTerms: readonly string[], text: string): number => {
  if (queryTerms.length === 0) return 0;

  const present = new Set(terms(text));
  let matched = 0;
  for (const term of queryTerms) if (present.has(term)) matched++;

  return round(matched / queryTerms.length);
};

/**
 * Symmetric overlap, for deciding whether two candidates say the same thing.
 *
 * Jaccard here and coverage above, in the same file, because the two questions
 * are genuinely different: "does this answer the query?" is directional and
 * "are these the same remark?" is not. Using one measure for both would make
 * near-duplicate detection sensitive to which of the pair was seen first.
 */
export const overlap = (left: string, right: string): number => {
  const a = new Set(terms(left));
  const b = new Set(terms(right));

  if (a.size === 0 || b.size === 0) return 0;

  let shared = 0;
  for (const term of a) if (b.has(term)) shared++;

  const union = a.size + b.size - shared;
  return union === 0 ? 0 : round(shared / union);
};

/** Whether any of `needles` appears as a term of `text`. Case- and form-insensitive. */
export const mentions = (text: string, needles: readonly string[]): readonly string[] => {
  if (needles.length === 0) return [];

  const present = new Set(terms(text));
  const found: string[] = [];

  for (const needle of needles) {
    // An entity may be a phrase ("the Nexa project"); it counts as mentioned
    // when every content word of it is present, which is stricter than any and
    // looser than an exact string match.
    const parts = terms(needle);
    if (parts.length === 0) continue;
    if (parts.every((part) => present.has(part))) found.push(needle);
  }

  return found;
};

export const round = (value: number): number => Math.round(value * 1_000) / 1_000;
