import type {
  InsightKind,
  InsightPolarity,
  Memory,
  MemorySource,
  Timestamp,
} from '@nexa/models';
import type { MemoryId } from '@nexa/shared';
import type { ReflectionConfig } from './config.js';
import { SOURCE_WEIGHT } from './config.js';
import type { ThemeIndex } from './themes.js';
import { licenses, themeFor } from './themes.js';
import { negates, round, spaced, tokenize, withoutNegation } from './text.js';

/**
 * Turning memories into things that can be counted.
 *
 * An `Observation` is one memory's contribution to one possible claim: this
 * memory, about this topic, of this kind, pointing this way. Everything after
 * this file is arithmetic over observations; everything before it is text. The
 * boundary is deliberate — it is the only place in the engine where English is
 * interpreted, so it is the only place where the interpretation can be wrong.
 *
 * ## Two independent axes, and they guard each other
 *
 * **Kind** comes from marker phrases and the memory's subject: *what sort of
 * claim* the sentence is making. **Topic** comes from the remaining content
 * words: *what it is about*. Neither alone is enough, and requiring both is what
 * keeps the engine from concluding things nobody said. "We're going away this
 * weekend" contains an `overwork` theme marker and no `condition` marker, so it
 * produces no observation at all — where a single-axis matcher would have read
 * a holiday as exhaustion.
 */

/** One memory's contribution to one possible claim. */
export interface Observation {
  readonly memoryId: MemoryId;
  /** When the memory was formed. Never when it was read. */
  readonly at: Timestamp;
  readonly source: MemorySource;
  readonly kind: InsightKind;
  /** `theme:<id>` or `literal:<stem>`. The claim's stable identity. */
  readonly topicKey: string;
  /** The readable topic — a theme's label, or the word as the user wrote it. */
  readonly topic: string;
  readonly viaTheme: boolean;
  /**
   * The token this observation came from.
   *
   * The breadth signal. A theme insight counts its distinct source tokens, which
   * is how "Unity, VR and AI" is told apart from "Unity, Unity and Unity" — the
   * difference between generalising over evidence and extrapolating past it.
   */
  readonly sourceToken: string;
  readonly polarity: InsightPolarity;
  /** How much this corroborates, 0–1. Provenance times the memory's own confidence. */
  readonly weight: number;
  /**
   * The memory's content, carried through the pass and never persisted.
   *
   * Used for one thing: deciding whether two memories in a cluster are the same
   * remark. `InsightEvidence` holds no content, so this dies with the pass.
   */
  readonly text: string;
}

/**
 * Markers for one kind of claim.
 *
 * Phrases rather than words wherever a word would over-match. "want" catches "I
 * want a coffee"; "i want to" catches an intention.
 */
export interface KindMarkers {
  readonly kind: InsightKind;
  readonly markers: readonly string[];
  /**
   * Markers that carry their own negation.
   *
   * "I can't seem to get this working" affirms a struggle, and the "can't" that
   * makes it a struggle would otherwise be read as denying one — inverting the
   * evidence at exactly the moment it is clearest. A memory matching one of
   * these is affirming, whatever else is in the sentence.
   */
  readonly negatedMarkers: readonly string[];
}

/**
 * The marker table, checked in this order.
 *
 * A memory may match several kinds and produces observations for all of them.
 * That is intentional: "keep it short please" is a `preference` and a
 * `communication` preference, and each is gated separately, so admitting both
 * costs nothing and dropping one would lose whichever consumer wanted it.
 */
export const KIND_MARKERS: readonly KindMarkers[] = [
  {
    kind: 'preference',
    markers: [
      'i prefer', 'i like', 'i love', 'i would rather', "i'd rather",
      'please always', 'please never', 'works better for me', 'suits me',
    ],
    negatedMarkers: [],
  },
  {
    kind: 'interest',
    markers: [
      'i enjoy', 'i love', 'interested in', 'i am into', "i'm into",
      'fascinated by', 'my favourite', 'my favorite', 'is fun', 'was fun',
    ],
    negatedMarkers: [],
  },
  {
    kind: 'habit',
    markers: [
      'i tend to', 'i usually', 'i always', 'i often', 'i keep',
      'most days', 'i end up', 'i habitually',
    ],
    negatedMarkers: [],
  },
  {
    kind: 'routine',
    markers: [
      'every morning', 'every evening', 'every night', 'every week',
      'each morning', 'each evening', 'my routine', 'before work',
      'after work', 'every day', 'first thing',
    ],
    negatedMarkers: [],
  },
  {
    kind: 'value',
    markers: [
      'matters to me', 'important to me', 'i believe', 'i care about',
      'i value', 'it matters that', 'what counts is',
    ],
    negatedMarkers: ['i would never', 'i could never'],
  },
  {
    kind: 'goal',
    markers: [
      'i want to', 'i am trying to', "i'm trying to", 'my goal',
      'i plan to', 'i hope to', 'working toward', 'working towards',
      'i need to learn', 'i am saving for',
    ],
    negatedMarkers: [],
  },
  {
    kind: 'struggle',
    markers: [
      'struggling with', 'i struggle', 'stuck on', 'having trouble',
      'hard time with', 'keeps breaking', 'went wrong again',
    ],
    negatedMarkers: [
      "can't seem to", 'cannot seem to', "can't get", "won't work",
      "still doesn't", "never works",
    ],
  },
  {
    kind: 'strength',
    markers: [
      'finally got', 'managed to', 'went well', 'i am good at',
      "i'm good at", 'got it working', 'proud of', 'came together',
    ],
    negatedMarkers: [],
  },
  {
    kind: 'communication',
    markers: [
      'keep it short', 'too long', 'too much detail', 'be brief',
      'in detail', 'explain', 'step by step', 'shorter answer',
      'less detail', 'more detail', 'straight to the point',
    ],
    negatedMarkers: [],
  },
  {
    kind: 'learning_style',
    markers: [
      'i learn best', 'learn by', 'show me', 'give me an example',
      'i need examples', 'i read the docs', 'i prefer reading',
    ],
    negatedMarkers: [],
  },
  {
    kind: 'condition',
    markers: [
      'exhausted', "i'm tired", 'i am tired', 'stayed awake', 'stayed up',
      'all weekend', 'all night', 'working late', 'burnt out', 'burned out',
      'running on empty', 'been flat out',
    ],
    negatedMarkers: ['no sleep', "haven't slept", 'have not slept', 'no energy'],
  },
];

/**
 * Memory subjects that name a kind on their own.
 *
 * These come from `@nexa/memory`'s classifier, which has already read the text
 * and decided. Ignoring that and re-deriving it from phrases here would be two
 * classifiers disagreeing about the same sentence — so where memory has already
 * committed, reflection takes its word for it.
 */
const SUBJECT_KINDS: Readonly<Record<string, InsightKind>> = {
  preference: 'preference',
  goal: 'goal',
};

/**
 * Words that describe the claim rather than its subject.
 *
 * Stripped from topic extraction so that "I prefer short answers" yields the
 * topic "short answers" and not "prefer". Kept apart from the stop list because
 * the stop list is about English and this is about *this engine's grammar* —
 * every word here is one that appears in a hedge or a marker, and letting one
 * through produces the insight "the user may prefer prefer".
 *
 * Stems, matched against `Token.key`.
 */
const TOPIC_NOISE = new Set([
  'prefer', 'like', 'love', 'hate', 'enjoy', 'rather', 'favourit', 'favorit',
  'want', 'try', 'plan', 'hope', 'goal', 'need', 'sav',
  'tend', 'usual', 'alway', 'oft', 'keep', 'habitual', 'end',
  'valu', 'believ', 'care', 'matt', 'import', 'count',
  'struggl', 'stuck', 'troubl', 'hard', 'wrong', 'break',
  'manag', 'proud', 'final', 'good', 'well', 'work',
  'learn', 'best', 'show', 'giv', 'pref',
  'user', 'me', 'my', 'am', 'is',
]);

/**
 * Whether a memory may be used as evidence at all.
 *
 * The first rule is the one that matters. **A memory the companion wrote from
 * its own reflection is never evidence for another reflection.** Without that,
 * an insight persisted as a `reflective` memory feeds the next pass, which
 * strengthens the insight, which is persisted again — and confidence grows
 * without a single new thing having happened. That is not a slow leak; it is a
 * companion talking itself into certainty about someone.
 *
 * The rest are ordinary hygiene, and `createdAt > at` is a replay guard: a pass
 * replayed at a past moment must not see evidence from the future, or replaying
 * history would produce insights the user never earned.
 */
export const eligible = (
  memory: Memory,
  at: Timestamp,
  withdrawn: ReadonlySet<string>,
  config: ReflectionConfig,
): boolean => {
  if (memory.source === 'reflection' || memory.type === 'reflective') return false;
  if (withdrawn.has(memory.id)) return false;
  if (Date.parse(memory.createdAt) > Date.parse(at)) return false;
  if (memory.expiresAt !== null && Date.parse(at) >= Date.parse(memory.expiresAt)) return false;
  if (memory.confidence < config.minEvidenceConfidence) return false;
  return true;
};

/**
 * Which kinds of claim this memory could be making. Ordered, deduplicated.
 *
 * Plain markers are looked for in the negation-elided view and self-negating
 * ones in the text as written, because the two need opposite things: "i enjoy"
 * has to survive "I do not enjoy", and "can't seem to" has to keep its "can't".
 */
const kindsIn = (
  memory: Memory,
): readonly { readonly kind: InsightKind; readonly selfNegating: boolean }[] => {
  const written = spaced(memory.content);
  const elided = withoutNegation(memory.content);
  const found: { kind: InsightKind; selfNegating: boolean }[] = [];

  for (const entry of KIND_MARKERS) {
    const selfNegating = entry.negatedMarkers.some((marker) => written.includes(marker));
    if (selfNegating || entry.markers.some((marker) => elided.includes(marker))) {
      found.push({ kind: entry.kind, selfNegating });
    }
  }

  const fromSubject = SUBJECT_KINDS[memory.subject];
  if (fromSubject !== undefined && !found.some((entry) => entry.kind === fromSubject)) {
    found.push({ kind: fromSubject, selfNegating: false });
  }

  return found;
};

/** The marker phrases present, longest first so removal cannot leave fragments. */
const matchedMarkers = (elided: string): readonly string[] => {
  const present: string[] = [];

  for (const entry of KIND_MARKERS) {
    for (const marker of [...entry.markers, ...entry.negatedMarkers]) {
      if (elided.includes(marker)) present.push(marker);
    }
  }

  return present.sort((a, b) => b.length - a.length);
};

interface Topic {
  readonly key: string;
  readonly surface: string;
  /**
   * Whether this word may stand as a topic on its own.
   *
   * False for words that identified the *kind*. Theme markers are exempt — see
   * below.
   */
  readonly literalAllowed: boolean;
}

/**
 * The topics a memory is about, in order of appearance.
 *
 * ## Marker words are stripped from the literal route and not from the theme one
 *
 * Two different filters, and the asymmetry is load-bearing. A word that
 * identified the kind must not also become the topic, or "I prefer short
 * answers" yields "the user may prefer prefer" — so marker phrases are removed
 * before literal topics are taken.
 *
 * Applying the same removal to theme matching destroys the engine's best cases.
 * "I'm exhausted" is a `condition` because of the word "exhausted" and is
 * *about* overwork because of the same word; strip it and the memory has no
 * topic left, and the clearest evidence available produces nothing at all.
 *
 * The rule that resolves it: **a word in the theme table is topic-bearing by
 * definition.** The lexicon is curated, so a marker appearing in it is a
 * deliberate statement that the word names something — which is exactly what the
 * generic stripping rule cannot know.
 *
 * Stripping works from the negation-elided view, which has a second effect worth
 * naming: "not", "never" and their kin are gone before literal topics are taken,
 * so no insight can ever be about the word "not".
 */
const topicsIn = (memory: Memory, index: ThemeIndex, config: ReflectionConfig): readonly Topic[] => {
  let stripped = withoutNegation(memory.content);
  for (const marker of matchedMarkers(stripped)) {
    stripped = stripped.split(marker).join(' ');
  }
  const survivors = new Set(tokenize(stripped).map((token) => token.key));

  const seen = new Set<string>();
  const topics: Topic[] = [];

  for (const token of tokenize(memory.content)) {
    if (seen.has(token.key)) continue;

    const inLexicon = themeFor(index, token.key) !== null;
    const literalAllowed = survivors.has(token.key) && !TOPIC_NOISE.has(token.key);
    if (!inLexicon && !literalAllowed) continue;

    seen.add(token.key);
    topics.push({ key: token.key, surface: token.surface, literalAllowed });
    if (topics.length >= config.maxTopicsPerMemory) break;
  }

  return topics;
};

/**
 * Every claim one memory could contribute to.
 *
 * Pure and total. A memory that matches no marker, or whose only kinds require a
 * theme it does not touch, produces an empty list — which is the ordinary
 * outcome and not a failure. Most of what a person says is not a pattern.
 */
export const observe = (
  memory: Memory,
  index: ThemeIndex,
  config: ReflectionConfig,
): readonly Observation[] => {
  const kinds = kindsIn(memory);
  if (kinds.length === 0) return [];

  const topics = topicsIn(memory, index, config);
  if (topics.length === 0) return [];

  const denied = negates(memory.content);
  const weight = round((SOURCE_WEIGHT[memory.source] ?? 0) * memory.confidence);
  const observations: Observation[] = [];
  const seen = new Set<string>();

  for (const { kind, selfNegating } of kinds) {
    const policy = config.kinds[kind];
    // A marker that carries its own negation has already accounted for it.
    const polarity: InsightPolarity = !selfNegating && denied ? 'denies' : 'affirms';

    for (const topic of topics) {
      const theme = themeFor(index, topic.key);
      const viaTheme = theme !== null && licenses(theme, kind);

      // A word the lexicon knows but which this kind's themes do not license
      // falls back to the literal route only if it was not a marker. A theme
      // that declines to express a kind is not an invitation to express it
      // anyway with a bare word.
      if (!viaTheme && (policy.requiresTheme || !topic.literalAllowed)) continue;

      const topicKey = viaTheme && theme !== null ? `theme:${theme.id}` : `literal:${topic.key}`;
      const label = viaTheme && theme !== null ? theme.label : topic.surface;

      // One memory may support a theme through two different words — "Unity and
      // VR" is breadth of two — but not through the same word twice.
      const fingerprint = `${kind}|${topicKey}|${topic.key}`;
      if (seen.has(fingerprint)) continue;
      seen.add(fingerprint);

      observations.push({
        memoryId: memory.id,
        at: memory.createdAt,
        source: memory.source,
        kind,
        topicKey,
        topic: label,
        viaTheme,
        sourceToken: topic.key,
        polarity,
        weight,
        text: memory.content,
      });
    }
  }

  return observations;
};
