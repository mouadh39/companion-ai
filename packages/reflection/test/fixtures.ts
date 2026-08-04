import type {
  Insight,
  InsightDecision,
  InsightDraft,
  Memory,
  ReflectionResult,
  Timestamp,
} from '@nexa/models';
import { confidence, importance, timestamp, valence } from '@nexa/models';
import type { InsightId, MemoryId, UserId } from '@nexa/shared';
import { materialise } from '@nexa/reflection';

export const NOW = '2026-08-01T12:00:00.000Z';
export const USER = 'user-1' as UserId;

export const at = (days = 0): Timestamp =>
  timestamp(new Date(Date.parse(NOW) + days * 86_400_000).toISOString());

/**
 * A memory with a content-derived id.
 *
 * Deriving the id from the text keeps every fixture reproducible without a
 * counter, and makes a failure message name the memory rather than an ordinal.
 * Two fixtures with the same content share an id on purpose — that is how a test
 * says "the same memory", which is a case the engine has to handle.
 */
export const memoryOf = (
  content: string,
  day = 0,
  overrides: Partial<Memory> = {},
): Memory => ({
  id: `mem-${content.toLowerCase().replace(/[^a-z0-9]+/gu, '-').slice(0, 28)}` as MemoryId,
  userId: USER,
  type: 'semantic',
  subject: 'temporary',
  content,
  createdAt: at(day),
  importance: importance(0.6),
  confidence: confidence(0.9),
  valence: valence(0),
  source: 'user_stated',
  expiresAt: null,
  reinforcementCount: 0,
  lastReinforcedAt: null,
  tags: [],
  relatedTo: [],
  embedding: null,
  metadata: {},
  ...overrides,
});

/** Deterministic ids, so a replay produces a byte-identical store. */
export const mintFrom = (prefix: string) => {
  let next = 0;
  return (draft: InsightDraft): InsightId => `${prefix}-${draft.key}-${next++}` as InsightId;
};

export const insightFrom = (draft: InsightDraft, id = 'ins-1'): Insight =>
  materialise(draft, id as InsightId, USER);

export const formations = (result: ReflectionResult): readonly InsightDraft[] =>
  result.decisions
    .filter((decision): decision is Extract<InsightDecision, { outcome: 'form' }> =>
      decision.outcome === 'form',
    )
    .map((decision) => decision.draft);

export const only = (result: ReflectionResult, outcome: InsightDecision['outcome']) =>
  result.decisions.filter((decision) => decision.outcome === outcome);

export const firstFormed = (result: ReflectionResult): InsightDraft => {
  const drafts = formations(result);
  const draft = drafts[0];
  if (draft === undefined) {
    throw new Error(
      `expected a formation; got ${result.decisions
        .map((d) => `${d.outcome}${d.outcome === 'decline' ? `(${d.reason})` : ''}`)
        .join(', ')}`,
    );
  }
  return draft;
};

/** The three remarks from the brief. Distinct topics, spread over three weeks. */
export const interactiveTechnology = (): readonly Memory[] => [
  memoryOf('I enjoy Unity.', 0),
  memoryOf('I enjoy VR.', 10),
  memoryOf('I enjoy AI.', 20),
];

/** The other example from the brief. Three days, three different signals. */
export const overworkWeek = (): readonly Memory[] => [
  memoryOf('I stayed awake until 3AM.', 0),
  memoryOf("I'm exhausted.", 1),
  memoryOf("I've been working all weekend.", 2),
];
