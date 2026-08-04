import type { EvidenceKind, ObservationDimension, ObservationEvidence } from '@nexa/models';

/**
 * The text channel's vocabulary and the machinery for matching it.
 *
 * Every phrase perception can recognise is in this file. That is a deliberate
 * constraint rather than a convenience: an engine whose triggers are scattered
 * through its extractors is one where "why did it think she was upset?" is
 * answered by reading four files and a regex, and where nobody notices that the
 * same word means two things in two places.
 *
 * ## Strength is a property of the cue, not of the dimension
 *
 * A self-report is strong evidence whatever it is evidence *of*; a passing
 * phrase is weak evidence whatever it is evidence of. So strength lives on the
 * evidence kind, uniformly, and the dimension's ceiling is applied afterwards.
 * Letting each lexicon entry pick its own number is how a table drifts into
 * being tuned entry by entry until nobody can say what a 0.7 means.
 */

/**
 * What each kind of cue is worth on its own.
 *
 * The gap between `self_report` and `phrase` is the whole basis of the
 * observed/possible distinction, and it is wide on purpose. "I am frustrated"
 * and "this is frustrating" differ by one word and by an enormous amount of
 * warrant: the first is a person telling you about themselves, the second is a
 * person telling you about a compiler.
 */
export const STRENGTH: Readonly<Record<EvidenceKind, number>> = {
  self_report: 0.85,
  phrase: 0.55,
  structural: 0.6,
  contextual: 0.5,
  /** Non-text channels supply their own; this is the default floor for them. */
  signal: 0.5,
};

/** How much of the message an excerpt may quote back. */
export const MAX_EXCERPT = 80;

export const evidence = (
  kind: EvidenceKind,
  cue: string,
  excerpt: string,
  strength = STRENGTH[kind],
): ObservationEvidence => ({
  kind,
  channel: 'text',
  cue,
  excerpt: excerpt.length > MAX_EXCERPT ? `${excerpt.slice(0, MAX_EXCERPT - 1)}…` : excerpt,
  strength,
});

/**
 * Emotion words, in the form a person uses about themselves.
 *
 * Stored as bare adjectives so the same list serves both stances: prefixed by a
 * first-person copula it is a self-report; appearing anywhere else it is a
 * phrase. Keeping one list means the two readings cannot drift apart — which
 * they would immediately if "frustrated" were spelled out in two places.
 */
export const EMOTION_WORDS: ReadonlyArray<readonly [ObservationDimension, readonly string[]]> = [
  [
    'frustration',
    ['frustrated', 'frustrating', 'annoyed', 'annoying', 'irritated', 'fed up', 'sick of'],
  ],
  ['excitement', ['excited', 'thrilled', 'pumped', 'buzzing', 'can not wait', "can't wait"]],
  ['curiosity', ['curious', 'intrigued', 'wondering', 'fascinated', 'interested in']],
  ['sadness', ['sad', 'down', 'gutted', 'miserable', 'unhappy', 'disappointed']],
  ['joy', ['happy', 'glad', 'delighted', 'pleased', 'chuffed', 'love this', 'love it']],
  ['confusion', ['confused', 'lost', 'baffled', 'puzzled', 'no idea what']],
  ['anxiety', ['anxious', 'worried', 'nervous', 'stressed', 'overwhelmed', 'panicking', 'panicked']],
  ['fatigue', ['tired', 'exhausted', 'shattered', 'knackered', 'drained', 'burnt out', 'worn out']],
  ['pride', ['proud', 'chuffed with', 'pleased with myself']],
  ['calm', ['calm', 'relaxed', 'fine with', 'at ease', 'no rush']],
];

/**
 * Ways a person says a thing is true *of themselves*.
 *
 * The list is short and rigid on purpose. Loosening it — accepting "feeling
 * frustrated" without a subject, say — is how "the build is feeling frustrated"
 * becomes a reading of the user's mood. When the phrasing is not clearly
 * first-person, the cue falls through to the weaker `phrase` reading, which is
 * the correct place for an ambiguous sentence to land.
 */
export const SELF_REPORT_PREFIXES: readonly string[] = [
  'i am',
  "i'm",
  'im',
  'i feel',
  "i'm feeling",
  'i am feeling',
  'i felt',
  'i was',
  'im feeling',
  'feeling',
  'i get',
  'i am so',
  "i'm so",
  'i am really',
  "i'm really",
  'i am a bit',
  "i'm a bit",
  'i am quite',
  "i'm quite",
];

/**
 * Phrases that suggest something went badly without saying how anyone feels.
 *
 * The engine's route to `possible` frustration, and the reason the brief's "I
 * guess nothing works" produces anything at all. None of these is a claim about
 * a person — which is exactly why nothing they support may ever be `observed`.
 */
export const NEGATIVE_OUTCOME_PHRASES: readonly string[] = [
  'nothing works',
  'still broken',
  'still not working',
  'not working',
  'does not work',
  "doesn't work",
  'keeps failing',
  'keeps breaking',
  'no luck',
  'went wrong',
  'gave up',
  'tried everything',
  'same error',
  'again and again',
];

/** Hedges. Uncertainty when stated about a claim, hesitation when about oneself. */
export const HEDGE_PHRASES: readonly string[] = [
  'i guess',
  'i suppose',
  'maybe',
  'perhaps',
  'possibly',
  'sort of',
  'kind of',
  'i think',
  'not sure',
  'unsure',
  'might be',
  'could be',
  'probably',
  'if that makes sense',
  'or something',
];

/** The opposite: phrasing that commits. */
export const CERTAINTY_PHRASES: readonly string[] = [
  'definitely',
  'certainly',
  'absolutely',
  'i know',
  'for sure',
  'without doubt',
  'obviously',
  'clearly',
  'no question',
];

export const URGENCY_PHRASES: readonly string[] = [
  'urgent',
  'asap',
  'right now',
  'immediately',
  'straight away',
  'quickly',
  'deadline',
  'due today',
  'running out of time',
  'need this now',
];

export const GREETING_PHRASES: readonly string[] = [
  'hello',
  'hi',
  'hey',
  'good morning',
  'good afternoon',
  'good evening',
  'morning',
  'howdy',
  'hiya',
];

export const FAREWELL_PHRASES: readonly string[] = [
  'bye',
  'goodbye',
  'good night',
  'goodnight',
  'see you',
  'talk later',
  'catch you later',
  'signing off',
  'that is all for now',
];

/** Explicit corrections. Distinguished from the softer openers below. */
export const CORRECTION_PHRASES: readonly string[] = [
  "that's wrong",
  'thats wrong',
  'that is wrong',
  'not right',
  'incorrect',
  'not true',
  'you misunderstood',
  'i did not say',
  "i didn't say",
  'not what i meant',
];

/** Openers that often precede a correction and often do not. */
export const SOFT_CORRECTION_PHRASES: readonly string[] = [
  'actually',
  'well, no',
  'not quite',
  'hmm, no',
  'sort of, but',
];

export const AGREEMENT_PHRASES: readonly string[] = [
  'yes',
  'yeah',
  'exactly',
  'agreed',
  'that makes sense',
  'you are right',
  "you're right",
  'good point',
  'sounds right',
  'true',
];

export const DISAGREEMENT_PHRASES: readonly string[] = [
  'i disagree',
  'i do not think',
  "i don't think",
  'not convinced',
  'i would not',
  "i wouldn't",
  'that is not',
  "that's not",
  'nope',
];

export const HELP_REQUEST_PHRASES: readonly string[] = [
  'can you',
  'could you',
  'please',
  'help me',
  'i need',
  'would you',
  'show me',
  'walk me through',
  'fix',
  'how do i',
];

export const PLANNING_PHRASES: readonly string[] = [
  'plan',
  'schedule',
  'roadmap',
  'next week',
  'tomorrow',
  'this sprint',
  'milestone',
  'timeline',
  'we should do',
  'first we',
  'after that',
];

export const REFLECTION_PHRASES: readonly string[] = [
  'looking back',
  'in hindsight',
  'i have been thinking',
  "i've been thinking",
  'i realised',
  'i realized',
  'i notice that i',
  'i tend to',
  'why do i',
];

export const BRAINSTORM_PHRASES: readonly string[] = [
  'what if',
  'ideas',
  'brainstorm',
  'options',
  'we could',
  'another approach',
  'alternatives',
  'off the top of my head',
];

export const LEARNING_PHRASES: readonly string[] = [
  'how does',
  'what is',
  'explain',
  'teach me',
  'i want to understand',
  'i am learning',
  "i'm learning",
  'why does',
  'difference between',
];

export const CASUAL_PHRASES: readonly string[] = [
  'thanks',
  'thank you',
  'cheers',
  'nice one',
  'lol',
  'haha',
  'no worries',
  'how are you',
];

export const QUESTION_OPENERS: readonly string[] = [
  'what',
  'why',
  'how',
  'when',
  'where',
  'who',
  'which',
  'can you',
  'could you',
  'do you',
  'is it',
  'are you',
  'should i',
];

/**
 * The message, prepared for phrase matching.
 *
 * Lowercased, punctuation turned to spaces, and padded at both ends so a phrase
 * match cannot straddle a word boundary. Punctuation has to go: "Hello." would
 * otherwise never match "hello", and a greeting detector that misses the most
 * common way anyone writes a greeting is worse than none.
 *
 * **Apostrophes survive.** Half the lexicon is contractions — "i'm", "can't",
 * "doesn't" — and stripping them would silently turn every one of those entries
 * into an unmatchable string. Structural cues that genuinely need the original
 * punctuation, like a trailing question mark, read the raw text instead.
 */
export const padded = (text: string): string =>
  ` ${text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()} `;

/**
 * Every phrase from `needles` present in `haystack`, in the order given.
 *
 * Order-preserving rather than first-match, because the count of distinct cues
 * is what the corroboration bonus reads — and a matcher that stopped at the
 * first hit would make every observation rest on exactly one piece of evidence,
 * quietly disabling the only legitimate way confidence rises.
 */
export const matches = (haystack: string, needles: readonly string[]): readonly string[] =>
  needles.filter((needle) => haystack.includes(` ${needle}`) || haystack.includes(`${needle} `));

/** The sentence containing a phrase, for quoting back. */
export const excerptAround = (text: string, phrase: string): string => {
  const lower = text.toLowerCase();
  const index = lower.indexOf(phrase.toLowerCase());
  if (index < 0) return text.slice(0, MAX_EXCERPT);

  const start = Math.max(0, index - 24);
  const end = Math.min(text.length, index + phrase.length + 24);
  return text.slice(start, end).trim();
};
