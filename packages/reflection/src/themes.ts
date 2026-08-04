import type { InsightKind } from '@nexa/models';
import { stem } from './text.js';

/**
 * The generalisation table.
 *
 * This is the honest answer to the hardest question in the engine. Turning "I
 * enjoy Unity", "I enjoy VR" and "I enjoy AI" into "the user enjoys building
 * interactive technology" requires knowing that those three things are the same
 * kind of thing — knowledge a language model has and a pure function does not.
 *
 * Rather than approximate it with a similarity metric that would generalise
 * unpredictably, the knowledge is written down. A theme is an explicit set of
 * marker words and the phrase they roll up to. Everything the engine can
 * generalise is visible in this file; everything it cannot, it declines to
 * generalise and reports literally instead.
 *
 * ## The fallback is the safety property
 *
 * When no theme matches, the engine does **not** invent an abstraction. It keeps
 * the literal token: three remarks about chess become "the user appears to enjoy
 * chess", never "the user appears to enjoy strategy games". A missing theme
 * costs a narrower insight. A guessed one puts a claim in the user's mouth that
 * nothing they said supports.
 *
 * ## The default set is small on purpose
 *
 * It is a starting lexicon, not a taxonomy of human life, and it is replaceable
 * wholesale through `ReflectionConfig.themes`. A large default table would be a
 * large surface of claims the engine can make about someone, shipped by people
 * who have never met them.
 *
 * ## Labels are grammar-bound
 *
 * A theme's `label` is dropped verbatim into its kinds' statement templates, so
 * it must fit their grammar — a noun phrase for `interest`, a participle for
 * `condition`. `kinds` therefore constrains not just what a theme is allowed to
 * claim but what its label has to read like. `themeGrammarIsConsistent` in the
 * tests is the check that keeps the two in step.
 */
export interface Theme {
  /** Stable identity. Becomes part of the insight key, so it must not change casually. */
  readonly id: string;
  /** The phrase substituted into a statement template. */
  readonly label: string;
  /** Which kinds of claim this theme may express. */
  readonly kinds: readonly InsightKind[];
  /** Surface words that indicate the theme. Stemmed at match time. */
  readonly markers: readonly string[];
}

/**
 * The shipped lexicon.
 *
 * Each entry earns its place by being something a companion genuinely needs to
 * generalise about and can recognise from ordinary vocabulary. Nothing here
 * names a mood, a diagnosis, a demographic or a belief: those are things the
 * engine has no business inferring from word counts, and leaving them out of the
 * table is what makes that a structural guarantee rather than a promise.
 */
export const DEFAULT_THEMES: readonly Theme[] = [
  {
    id: 'interactive-technology',
    label: 'building interactive technology',
    kinds: ['interest', 'preference', 'goal', 'struggle', 'strength'],
    markers: [
      'unity', 'unreal', 'godot', 'blender', 'shader', 'shaders',
      'vr', 'ar', 'xr', 'headset', 'gamedev', 'game', 'games',
      'ai', 'ml', 'robotics', 'simulation', 'rendering', 'prototype',
    ],
  },
  {
    /**
     * The one `condition` theme, and the reason `condition` exists.
     *
     * Its label is "overworking" — a description of what someone is doing. It is
     * deliberately not "burnt out", "depressed" or "struggling to cope", which
     * are descriptions of what someone *is*, and which a word-matching engine
     * has no standing to conclude. The line between the two is the line between
     * noticing and diagnosing.
     */
    id: 'overwork',
    label: 'overworking',
    kinds: ['condition'],
    markers: [
      'exhausted', 'exhaustion', 'tired', 'drained', 'shattered',
      'sleep', 'awake', 'insomnia', 'overtime', 'weekend', 'weekends',
      '1am', '2am', '3am', '4am', 'midnight', 'nonstop', 'crunch',
    ],
  },
  {
    id: 'early-mornings',
    label: 'early mornings',
    kinds: ['habit', 'routine'],
    markers: ['morning', 'mornings', 'sunrise', 'dawn', '5am', '6am', '7am', 'early'],
  },
  {
    id: 'late-nights',
    label: 'late nights',
    kinds: ['habit', 'routine'],
    markers: ['night', 'nights', 'evening', 'evenings', '10pm', '11pm', 'midnight', 'late'],
  },
  {
    id: 'concise-answers',
    label: 'short, direct answers',
    kinds: ['communication', 'preference'],
    markers: ['short', 'shorter', 'brief', 'briefly', 'concise', 'terse', 'summary', 'tldr'],
  },
  {
    id: 'detailed-explanations',
    label: 'detailed explanations',
    kinds: ['communication', 'preference'],
    markers: ['detail', 'detailed', 'thorough', 'depth', 'explanation', 'elaborate', 'context'],
  },
  {
    id: 'learning-by-doing',
    label: 'by working through examples',
    kinds: ['learning_style'],
    markers: ['example', 'examples', 'hands', 'practice', 'doing', 'tinker', 'experiment'],
  },
  {
    id: 'learning-by-reading',
    label: 'by reading things through first',
    kinds: ['learning_style'],
    markers: ['docs', 'documentation', 'manual', 'spec', 'article', 'theory', 'reading'],
  },
];

/**
 * A theme lexicon indexed by stemmed marker, built once.
 *
 * Built rather than searched because a linear scan over every theme's markers
 * for every token of every memory is quadratic in the two things that grow —
 * lexicon size and evidence window — on a pass that is meant to run over a
 * user's whole history.
 *
 * A marker claimed by two themes resolves to the **first** theme in the supplied
 * order. That makes the table's order meaningful and the outcome stable:
 * "midnight" belongs to `overwork` rather than `late-nights` because `overwork`
 * is listed first, and reordering the table is therefore a deliberate change
 * rather than an invisible one.
 */
export interface ThemeIndex {
  readonly byMarker: ReadonlyMap<string, Theme>;
  readonly themes: readonly Theme[];
}

export const indexThemes = (themes: readonly Theme[]): ThemeIndex => {
  const byMarker = new Map<string, Theme>();

  for (const theme of themes) {
    for (const marker of theme.markers) {
      const key = stem(marker.toLowerCase());
      if (!byMarker.has(key)) byMarker.set(key, theme);
    }
  }

  return { byMarker, themes };
};

/**
 * The theme a token belongs to, or null.
 *
 * Null is the common answer and the safe one — it sends the observation down the
 * literal route, where the claim stays as narrow as the evidence.
 */
export const themeFor = (index: ThemeIndex, tokenKey: string): Theme | null =>
  index.byMarker.get(tokenKey) ?? null;

/** Whether a theme is allowed to express a given kind of claim. */
export const licenses = (theme: Theme, kind: InsightKind): boolean =>
  theme.kinds.includes(kind);
