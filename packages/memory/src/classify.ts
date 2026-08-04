import type { MemoryProposal, MemorySubject } from '@nexa/models';

/**
 * Works out what a proposal is about.
 *
 * **A deterministic heuristic, and deliberately a modest one.** Classification
 * is the part of formation that most wants a language model, and this engine
 * may not call one — so this is lexical, ordered, and honest about what it can
 * see. It exists to be replaced: a later classifier fits behind the same
 * signature, and everything downstream is written against `MemorySubject`
 * rather than against how the subject was arrived at.
 *
 * ## Order is precedence, and the order is deliberate
 *
 * Checks run most-specific first and return on the first hit. A message can
 * legitimately match several — "my sister got married" is both relationship and
 * milestone — and the ordering decides which policy governs retention. Milestone
 * outranks relationship because a wedding is an event that happened, and losing
 * it after two years would be worse than losing the fact that a sister exists.
 *
 * ## What it does when it cannot tell
 *
 * Falls back to `temporary`, which is the *cheap* wrong answer. A misclassified
 * temporary memory expires in a day; a misclassified identity memory is asserted
 * about the user forever. Where the classifier is unsure, the failure should be
 * forgetting something it could have kept — never inventing something permanent.
 */

/** Tag prefixes a caller can use to state the subject without ambiguity. */
const TAG_SUBJECTS: Readonly<Record<string, MemorySubject>> = {
  identity: 'identity',
  preference: 'preference',
  goal: 'goal',
  project: 'project',
  milestone: 'milestone',
  relationship: 'relationship',
  temporary: 'temporary',
};

/**
 * Markers per subject, checked in the order below.
 *
 * Phrases rather than single words wherever a single word would over-match.
 * "want" alone catches "I want a coffee"; "i want to" catches an intention.
 */
const MARKERS: readonly (readonly [MemorySubject, readonly string[]])[] = [
  [
    'milestone',
    [
      'got married', 'graduated', 'was born', 'passed away', 'died',
      'got the job', 'got promoted', 'finished my', 'completed my',
      'first time i', 'anniversary', 'we met',
    ],
  ],
  [
    'identity',
    [
      'my name is', 'i am called', 'i work as', 'i am a ', 'i live in',
      'i was born', 'my job is', 'i study', 'my birthday is',
    ],
  ],
  [
    'preference',
    [
      'i prefer', 'i like', 'i love', 'i hate', 'i do not like', "i don't like",
      'please always', 'please never', 'i would rather', 'keep it short',
    ],
  ],
  [
    'goal',
    [
      'i want to', 'i am trying to', 'my goal', 'i plan to', 'i hope to',
      'i need to learn', 'i am saving for',
    ],
  ],
  [
    'project',
    [
      'i am working on', 'i am building', 'my project', 'we are building',
      'at work i am',
    ],
  ],
  [
    'relationship',
    [
      'my wife', 'my husband', 'my partner', 'my mother', 'my father',
      'my mum', 'my dad', 'my sister', 'my brother', 'my son', 'my daughter',
      'my friend', 'my boss', 'my colleague',
    ],
  ],
];

export const classify = (proposal: MemoryProposal): MemorySubject => {
  // A supplied subject always wins. The caller may know things the text does
  // not say — that this came from a settings screen, or from the goal engine.
  if (proposal.subject !== undefined) return proposal.subject;

  // Then an explicit tag, which is how a caller states the subject without
  // having to phrase the content to suit a matcher.
  for (const tag of proposal.tags) {
    const tagged = TAG_SUBJECTS[tag.toLowerCase()];
    if (tagged !== undefined) return tagged;
  }

  const text = ` ${proposal.content.toLowerCase().replace(/\s+/gu, ' ')} `;
  for (const [subject, markers] of MARKERS) {
    if (markers.some((marker) => text.includes(marker))) return subject;
  }

  return 'temporary';
};
