import type {
  ConversationTurn,
  TextPercept,
  ConversationPlan,
  ExpressionProfile,
  Goal,
  IdentityProfile,
  PerceptionOutcome,
  TaskPlan,
  RelationshipProfile,
  RetrievalOutcome,
  Strategy,
  Timestamp,
} from '@nexa/models';
import { confidence, initialCounters, priority, progress, timestamp } from '@nexa/models';
import { perceive } from '@nexa/perception';
import type { PlanningRequest } from '@nexa/planning';
import { plan } from '@nexa/planning';

export const NOW = '2026-08-01T12:00:00.000Z';

export const at = (minutes = 0): Timestamp =>
  timestamp(new Date(Date.parse(NOW) + minutes * 60_000).toISOString());

/**
 * Perception is run for real rather than hand-built.
 *
 * Planning's most important behaviours turn on the observed/possible
 * distinction, and a stubbed `PerceptionOutcome` would let a fixture assert a
 * stance the real engine would never produce. Running the real one keeps the two
 * engines honest about each other — and catches the case where a change to
 * perception silently changes what planning decides.
 */
export const seen = (
  text: string,
  conversation: readonly ConversationTurn[] = [],
): PerceptionOutcome => {
  const percept: TextPercept = { channel: 'text', at: at(0), text };
  return perceive({ percepts: [percept], conversation, at: at(0) });
};

export const turnOf = (
  role: ConversationTurn['role'],
  content: string,
  minutes = 0,
): ConversationTurn => ({ role, content, at: at(minutes) });

/** A retrieval outcome with `count` memory items at the given score. */
export const retrieved = (count: number, score = 0.6): RetrievalOutcome => ({
  items: Array.from({ length: count }, (_, index) => ({
    rank: index + 1,
    retrievalClass: 'project' as const,
    durability: 'durable' as const,
    score,
    signals: {
      semantic: 0, lexical: score, entity: 0, goal_relevance: 0, topic_continuity: 0,
      emotional_fit: 0, recency: 0.5, reinforcement: 0, importance: 0.5,
      confidence: 0.8, stability: 0, relationship_fit: 0,
    },
    anchor: 'lexical' as const,
    anchorStrength: score,
    reasons: [],
    boundaries: [],
    text: `memory ${index}`,
    estimatedTokens: 3,
    source: 'memory' as const,
    memory: { id: `mem-${index}` } as never,
  })),
  excluded: [],
  consideredCount: count,
  excludedCount: 0,
  spend: { items: count, tokens: count * 3, perClass: {} },
  degraded: [],
  reasons: [],
  at: at(0),
});

/** A retrieval outcome whose items are all insights — nothing the user said. */
export const inferredOnly = (count = 2): RetrievalOutcome => {
  const base = retrieved(count, 0.5);
  return {
    ...base,
    items: base.items.map((item, index) => ({
      ...item,
      retrievalClass: 'reflection' as const,
      source: 'insight' as const,
      insight: { id: `ins-${index}` } as never,
      memory: undefined as never,
    })),
  };
};

/** A retrieval outcome whose items carry an identity boundary flag. */
export const flaggingBoundary = (boundaryId: string): RetrievalOutcome => {
  const base = retrieved(1, 0.6);
  return {
    ...base,
    items: base.items.map((item) => ({ ...item, boundaries: [boundaryId] })),
  };
};

/** Retrieval ran and found nothing. Different from retrieval not running. */
export const foundNothing = (): RetrievalOutcome => ({ ...retrieved(0), consideredCount: 8 });

export const goalOf = (description: string, weight = 0.7): Goal => ({
  id: `goal-${description.slice(0, 12).replace(/\s+/gu, '-')}` as Goal['id'],
  userId: 'user-1' as Goal['userId'],
  description,
  status: 'active',
  horizon: 'short_term',
  origin: 'user_stated',
  priority: priority(weight),
  progress: progress(0.3),
  createdAt: at(-1_000),
  updatedAt: at(-10),
  dueAt: null,
  completedAt: null,
  parentId: null,
  dependsOn: [],
  rationale: null,
  metadata: {},
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
  collaboration: { ...initialCounters(), requestsHandled: 12 },
  inferredStyle: null,
  boundaries: [],
  nextStage: 'close',
  progress: 0.4,
  blockers: [],
  rationale: [],
  ...overrides,
});

export const expressionOf = (
  overrides: Partial<ExpressionProfile> = {},
): ExpressionProfile => ({
  tone: 'warm',
  detail: 'moderate',
  initiative: 'lead',
  pacing: 'brisk',
  curiosity: 0.6,
  humor: 0.3,
  emotionalExpression: 0.5,
  warmth: 0.6,
  formality: 0.4,
  directness: 0.6,
  energy: 0.5,
  boundaries: [],
  rationale: [],
  ...overrides,
});

/** A minimal identity with the two things planning actually reads. */
export const identityOf = (
  overrides: Partial<IdentityProfile> = {},
): IdentityProfile => ({
  name: 'Nexa',
  role: 'companion',
  mission: 'help',
  purpose: [],
  values: [],
  commitments: [],
  autonomy: [
    { id: 'ask-before-irreversible', statement: 'Ask first.', onConflict: 'ask' },
  ],
  capabilities: [],
  limitations: [],
  knowledgeBoundaries: [
    { id: 'medical', domain: 'medical advice', stance: 'defers', reason: 'Not qualified.' },
  ],
  uncertainty: [
    { band: 'certain', atLeast: 0.95, disclose: false, defer: false, guidance: '' },
    { band: 'confident', atLeast: 0.75, disclose: false, defer: false, guidance: '' },
    { band: 'tentative', atLeast: 0.5, disclose: true, defer: false, guidance: '' },
    { band: 'unsure', atLeast: 0.25, disclose: true, defer: true, guidance: '' },
    { band: 'unknown', atLeast: 0, disclose: true, defer: true, guidance: '' },
  ],
  invariants: [],
  version: 1,
  revisedAt: NOW,
  ...overrides,
});

export const taskPlanOf = (blocked = false): TaskPlan => ({
  planId: 'plan-1' as TaskPlan['planId'],
  goalId: 'goal-1' as TaskPlan['goalId'],
  steps: [
    { description: 'first', status: 'done', toolId: null, blockedReason: null },
    {
      description: 'second',
      status: blocked ? 'blocked' : 'active',
      toolId: null,
      blockedReason: blocked ? 'waiting on a decision' : null,
    },
  ],
  activeStepIndex: 1,
  revisedAt: at(-30),
});

/** Plans a message with sensible defaults, overridable per test. */
export const planFor = (
  text: string,
  overrides: Partial<PlanningRequest> = {},
): ConversationPlan =>
  plan({
    at: at(0),
    perception: seen(text, overrides.conversation ?? []),
    ...overrides,
  });

export const evaluationOf = (result: ConversationPlan, strategy: Strategy) =>
  result.considered.find((evaluation) => evaluation.strategy === strategy);

export const reasonCodes = (result: ConversationPlan): readonly string[] =>
  result.rationale.map((reason) => reason.code);

export const confidenceOf = (value: number) => confidence(value);
