import type { ExcludedCandidate } from '@nexa/models';
import type { Ranked } from './rank.js';
import { overlap } from './text.js';

/**
 * Collapsing the things that say the same thing twice.
 *
 * Three different redundancies, and they are not the same problem:
 *
 * 1. **The same object twice.** A caller that unions two candidate queries will
 *    hand over duplicates. Cheap to detect, and silent corruption of every
 *    per-class count if missed.
 * 2. **Two objects saying one thing.** Memory formation dedupes what it can, but
 *    it compares lexically and a paraphrase gets through. Two slots spent on one
 *    fact is one slot stolen from something else.
 * 3. **An insight and its own evidence.** The one that only exists because
 *    reflection does, and the most valuable of the three.
 *
 * Everything removed here is *reported*, never silently dropped — the caller
 * asked what became active and "three near-identical memories collapsed into
 * one" is part of the answer.
 */

export interface DedupeResult {
  readonly kept: readonly Ranked[];
  readonly removed: readonly ExcludedCandidate[];
}

/**
 * Removes redundancy from an already-ordered list.
 *
 * Order matters and the input must already be ranked: every rule keeps the
 * *first* occurrence, so "first" has to mean "best" rather than "whichever
 * arrived first". Running this before ranking would collapse a strong candidate
 * into a weak one that happened to be earlier in the caller's array.
 */
export const dedupe = (
  ranked: readonly Ranked[],
  duplicateThreshold: number,
): DedupeResult => {
  const kept: Ranked[] = [];
  const removed: ExcludedCandidate[] = [];
  const seenIds = new Set<string>();

  /**
   * Memory ids covered by an insight already kept.
   *
   * Built as we go rather than up front, because only a *selected* insight
   * subsumes its evidence. An insight that never made the cut has not said
   * anything, and demoting the memories it was drawn from on the strength of a
   * conclusion nobody is going to hear would lose the evidence and the
   * conclusion both.
   */
  const spokenFor = new Map<string, string>();

  for (const entry of ranked) {
    const { candidate } = entry;

    if (seenIds.has(candidate.id)) {
      removed.push(
        exclusion(entry, 'duplicate', `Already present as ${candidate.id}.`),
      );
      continue;
    }

    const subsumer = spokenFor.get(candidate.id);
    if (subsumer !== undefined) {
      removed.push(
        exclusion(
          entry,
          'subsumed_by_insight',
          `Insight ${subsumer} was selected and already rests on this memory.`,
        ),
      );
      continue;
    }

    const restates = kept.find(
      (earlier) => overlap(earlier.candidate.text, candidate.text) >= duplicateThreshold,
    );
    if (restates !== undefined) {
      removed.push(
        exclusion(
          entry,
          'duplicate',
          `Restates ${restates.candidate.id}, which ranked higher.`,
        ),
      );
      continue;
    }

    seenIds.add(candidate.id);
    kept.push(entry);

    for (const memoryId of candidate.evidence) {
      if (!spokenFor.has(memoryId)) spokenFor.set(memoryId, candidate.id);
    }
  }

  return { kept, removed };
};

const exclusion = (
  entry: Ranked,
  reason: ExcludedCandidate['reason'],
  detail: string,
): ExcludedCandidate => ({
  id: entry.candidate.id,
  source: entry.candidate.payload.source,
  retrievalClass: entry.candidate.retrievalClass,
  reason,
  detail,
  bestSignal: entry.anchor,
  bestSignalStrength: entry.anchorStrength,
});
