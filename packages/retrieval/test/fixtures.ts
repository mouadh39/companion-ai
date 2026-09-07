import type {
  ConversationTurn,
  Goal,
  Observation,
  ObservationDimension,
  PerceptionOutcome,
  Insight,
  InsightKind,
  Memory,
  MemorySubject,
  MemoryType,
  RelationshipProfile,
  RetrievalItem,
  RetrievalOutcome,
  Timestamp,
} from '@nexa/models';
import {
  confidence,
  importance,
  initialCounters,
  insightKey,
  priority,
  progress,
  timestamp,
  valence,
} from '@nexa/models';
import type { CompanionId, InsightId, MemoryId, UserId } from '@nexa/shared';

export const NOW = '2026-08-01T12:00:00.000Z';
export const USER = 'user-1' as UserId;
export const COMPANION = 'companion-1' as CompanionId;

export const at = (days = 0): Timestamp =>
  timestamp(new Date(Date.parse(NOW) + days * 86_400_000).toISOString());

const slug = (text: string): string =>
  text.toLowerCase().replace(/[^a-z0-9]+/gu, '-').slice(0, 32);

export const memoryOf = (
  content: string,
  subject: MemorySubject,
  daysAgo = 0,
  overrides: Partial<Memory> = {},
): Memory => ({
  id: `mem-${slug(content)}` as MemoryId,
  userId: USER,
  companionId: COMPANION,
  type: subject === 'milestone' ? 'episodic' : 'semantic',
  subject,
  content,
  createdAt: at(-daysAgo),
  importance: importance(0.6),
  confidence: confidence(0.85),
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

/** An episodic temporary memory — what the engine calls a `recent_event`. */
export const eventOf = (content: string, daysAgo = 0, overrides: Partial<Memory> = {}): Memory =>
  memoryOf(content, 'temporary', daysAgo, { type: 'episodic' as MemoryType, ...overrides });

export const insightOf = (
  statement: string,
  kind: InsightKind,
  daysAgo = 0,
  overrides: Partial<Insight> = {},
): Insight => ({
  id: `ins-${slug(statement)}` as InsightId,
  userId: USER,
  companionId: COMPANION,
  key: insightKey(kind, `literal:${slug(statement)}`),
  kind,
  topicKey: `literal:${slug(statement)}`,
  topic: slug(statement),
  polarity: 'affirms',
  statement,
  status: 'active',
  certainty: 'probable',
  confidence: confidence(0.55),
  evidenceConfidence: confidence(0.55),
  stability: 0.5,
  supporting: [],
  opposing: [],
  createdAt: at(-daysAgo),
  updatedAt: at(-daysAgo),
  lastSupportedAt: at(-daysAgo),
  expiresAt: null,
  revision: 0,
  supersedes: null,
  supersededBy: null,
  retirement: null,
  provenance: { ruleset: 'reflection/1', windowFrom: at(-daysAgo), windowTo: at(-daysAgo) },
  history: [],
  ...overrides,
});

export const goalOf = (description: string, weight = 0.7): Goal => ({
  id: `goal-${slug(description)}` as Goal['id'],
  userId: USER,
  description,
  status: 'active',
  horizon: 'short_term',
  origin: 'user_stated',
  priority: priority(weight),
  progress: progress(0.3),
  createdAt: at(-30),
  updatedAt: at(-1),
  dueAt: null,
  completedAt: null,
  parentId: null,
  dependsOn: [],
  rationale: null,
  metadata: {},
});

/**
 * One emotional observation, as perception would report it.
 *
 * `stance` defaults to `observed` — the user said it. Tests that need the
 * inferred case pass `'possible'` and get perception's own ceiling behaviour:
 * a lower confidence, and therefore a lower anchor intensity.
 */
export const feeling = (
  dimension: ObservationDimension,
  magnitude = 0.8,
  stance: Observation['stance'] = 'observed',
): Observation => ({
  dimension,
  family: 'emotion',
  stance,
  channel: 'text',
  magnitude,
  confidence: confidence(0.8),
  evidence: [
    { kind: 'self_report', channel: 'text', cue: dimension, excerpt: '', strength: 0.8 },
  ],
  at: at(0),
});

export interface HeardOptions {
  readonly emotion?: Observation | null;
  readonly entities?: readonly string[];
  readonly observations?: readonly Observation[];
}

/**
 * A message and what perception made of it.
 *
 * Returns both halves of retrieval's contract, because `PerceptionOutcome`
 * deliberately holds observations rather than the utterance and lexical matching
 * needs the words. Spread into a request: `ask({ ...heard('Unity'), memories })`.
 *
 * Built by hand rather than by running `@nexa/perception`, so retrieval's tests
 * add no dependency. Wiring them to the real engine — as `@nexa/planning`'s
 * tests do — is the better long-term shape and is deliberately out of scope here.
 */
export const heard = (
  text: string,
  options: HeardOptions = {},
): { readonly message: string; readonly perception: PerceptionOutcome } => ({
  message: text,
  perception: {
    observations: [
      ...(options.emotion == null ? [] : [options.emotion]),
      ...(options.observations ?? []),
    ],
    unknown: [],
    tensions: [],
    references: (options.entities ?? []).map((entity) => ({
      text: entity,
      kind: 'capitalised' as const,
    })),
    channels: ['text'],
    reasons: [],
    at: at(0),
  },
});

export const turnOf = (role: ConversationTurn['role'], content: string, daysAgo = 0): ConversationTurn => ({
  role,
  content,
  at: at(-daysAgo),
});

export const relationshipOf = (
  overrides: Partial<RelationshipProfile> = {},
): RelationshipProfile => ({
  stage: 'familiar',
  dimensions: { trust: 0.7, familiarity: 0.7, warmth: 0.6, reliance: 0.5 },
  initiative: 'offer',
  personalization: 'moderate',
  cadence: 'regular',
  sharedUnderstanding: 0.6,
  collaboration: { ...initialCounters(), requestsHandled: 20, plansSupported: 10 },
  inferredStyle: null,
  boundaries: [],
  nextStage: 'close',
  progress: 0.4,
  blockers: [],
  rationale: [],
  ...overrides,
});

/** Ids of everything retrieved, in rank order. */
export const idsOf = (outcome: RetrievalOutcome): readonly string[] =>
  outcome.items.map((item) => idOf(item));

export const idOf = (item: RetrievalItem): string => {
  switch (item.source) {
    case 'memory':
      return item.memory.id;
    case 'insight':
      return item.insight.id;
    case 'relationship':
      return `relationship:${item.relationship.stage}`;
  }
};

export const excludedFor = (outcome: RetrievalOutcome, id: string) =>
  outcome.excluded.find((entry) => entry.id === id);

/**
 * The Unity scenario from the brief.
 *
 * Four things that should surface and three that should not, mixed together so
 * a test cannot pass by retrieving everything.
 */
export const unityWorld = (): readonly Memory[] => [
  memoryOf('I prefer Unity over Unreal for prototyping.', 'preference', 40),
  memoryOf('The Nexa project is built in Unity.', 'project', 60),
  eventOf('We talked about VR headset comfort in Unity.', 3),
  memoryOf('I like pizza with extra cheese.', 'preference', 20),
  memoryOf('The Canada trip last summer was wonderful.', 'milestone', 300),
  memoryOf('I need new guitar strings.', 'temporary', 2),
];

/** The frustration scenario from the brief. */
export const frustratedWorld = (): {
  readonly memories: readonly Memory[];
  readonly insights: readonly Insight[];
} => ({
  memories: [
    eventOf('We spent the evening debugging the shader compiler.', 1),
    eventOf('Another debugging session on the render pipeline.', 2),
    memoryOf('I like pizza with extra cheese.', 'preference', 20),
  ],
  insights: [
    insightOf('The user may currently be overworking.', 'condition', 1),
    insightOf('The user consistently prefers short, direct answers.', 'communication', 30),
    insightOf('The user appears to enjoy chess.', 'interest', 90),
  ],
});
