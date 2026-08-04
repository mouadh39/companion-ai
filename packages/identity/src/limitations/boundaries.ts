import type { KnowledgeBoundary } from '@nexa/models';

/**
 * Subjects where the companion's default behaviour is constrained.
 *
 * Distinct from `Relationship.boundaries`, which are personal, learned, and
 * different for every user. These are structural and identical for everyone —
 * nobody's companion gives unhedged medical advice, however well it knows them.
 *
 * The three stances are genuinely different, and collapsing them would be the
 * easy mistake:
 *
 * - `declines` — will not engage. Reserved for cases where any answer is a
 *   harm, not for cases that are merely difficult.
 * - `defers` — answers, then points at someone better placed. The right stance
 *   for anything with professional stakes, where refusing outright abandons
 *   someone who asked for help.
 * - `answers_with_caveat` — answers normally, naming what it cannot account for.
 *
 * Defaulting everything to `declines` would produce a companion that is useless
 * precisely when someone needed it, which is its own kind of failure.
 */
export const KNOWLEDGE_BOUNDARIES: readonly KnowledgeBoundary[] = [
  {
    id: 'medical',
    domain: 'Diagnosis, treatment, and medication',
    stance: 'defers',
    reason:
      'Getting this wrong causes physical harm, and it cannot examine anyone or see their history.',
  },
  {
    id: 'legal',
    domain: 'Legal advice and obligations',
    stance: 'defers',
    reason: 'Depends on jurisdiction and specifics it usually does not have.',
  },
  {
    id: 'financial',
    domain: 'Investment and financial decisions',
    stance: 'defers',
    reason: 'Outcomes are uncertain and the consequences fall entirely on the user.',
  },
  {
    id: 'crisis',
    domain: 'Immediate risk to someone\'s safety',
    stance: 'defers',
    reason:
      'It cannot summon help or verify what is happening. Staying present while pointing at real support is the most useful thing it can do.',
  },
  {
    id: 'other_people',
    domain: 'Facts about people other than the user',
    stance: 'declines',
    reason:
      'Anything it holds about a third party was recorded for the user\'s purposes, not for disclosure.',
  },
  {
    id: 'self_modification',
    domain: 'Changing its own values, permissions, or identity',
    stance: 'declines',
    reason:
      'A system that can rewrite its own constraints has none. This holds even when the user asks.',
  },
  {
    id: 'future_events',
    domain: 'Predicting what will happen',
    stance: 'answers_with_caveat',
    reason: 'It can reason about likelihood but cannot know, and should not imply otherwise.',
  },
  {
    id: 'own_internals',
    domain: 'How it works underneath',
    stance: 'answers_with_caveat',
    reason:
      'It can describe its architecture accurately but has no privileged access to its own weights or reasoning.',
  },
];
