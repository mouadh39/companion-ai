import type { InteractionSignal, IntentKind, Relationship } from '@nexa/models';
import { initialCounters, initialRelationshipDimensions, timestamp } from '@nexa/models';

/** A relationship at first contact, on a fixed date. */
export const START = '2026-01-01T00:00:00.000Z';

export const relationshipAt = (overrides: Partial<Relationship> = {}): Relationship => ({
  id: 'rel-1' as Relationship['id'],
  userId: 'user-1' as Relationship['userId'],
  companionId: 'comp-1' as Relationship['companionId'],
  type: 'new',
  dimensions: initialRelationshipDimensions(),
  interactionCount: 0,
  firstMetAt: timestamp(START),
  lastInteractionAt: timestamp(START),
  inferredStyle: null,
  boundaries: [],
  counters: initialCounters(),
  metadata: {},
  ...overrides,
});

/** `days` after START, as an ISO timestamp. */
export const dayOffset = (days: number): string =>
  new Date(Date.parse(START) + days * 86_400_000).toISOString();

export const signalAt = (
  days: number,
  overrides: Partial<InteractionSignal> = {},
): InteractionSignal => ({
  at: timestamp(dayOffset(days)),
  intent: 'statement',
  exchangeTurns: 2,
  corrected: false,
  acknowledgedUncertainty: false,
  ...overrides,
});

/**
 * A realistic history: `count` interactions spread evenly across `days`.
 *
 * Used to test that progression needs *both* volume and elapsed time — the same
 * count compressed into an afternoon must not reach the same stage.
 */
export const spread = (
  count: number,
  days: number,
  overrides: Partial<InteractionSignal> = {},
): readonly InteractionSignal[] =>
  Array.from({ length: count }, (_, index) =>
    signalAt((index + 1) * (days / count), overrides),
  );

/**
 * A mixed history, cycling through the interaction kinds a real user produces.
 *
 * Single-intent histories are useful for isolating one rule but cannot reach
 * the later stages: `trusted` requires `reliance`, which only requests and
 * planning build, and an all-emotional-support history never earns it. That is
 * the threshold table working — a companion confided in but never relied on is
 * not a long-term companion — so any test of the upper stages has to look like
 * an actual relationship.
 */
export const mixed = (
  count: number,
  days: number,
): readonly InteractionSignal[] => {
  const cycle: readonly IntentKind[] = [
    'planning',
    'emotional_support',
    'request',
    'casual',
    'question',
  ];

  return Array.from({ length: count }, (_, index) =>
    signalAt((index + 1) * (days / count), {
      intent: cycle[index % cycle.length] ?? 'statement',
      exchangeTurns: index % 3 === 0 ? 8 : 3,
      acknowledgedUncertainty: index % 7 === 0,
    }),
  );
};
