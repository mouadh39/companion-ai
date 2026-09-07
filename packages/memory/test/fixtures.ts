import type { Memory, MemoryProposal, MemorySubject } from '@nexa/models';
import {
  confidence,
  defaultPreferences,
  importance,
  timestamp,
  valence,
} from '@nexa/models';
import { policyFor } from '@nexa/memory';

export const NOW = '2026-08-01T12:00:00.000Z';

export const at = (days = 0): ReturnType<typeof timestamp> =>
  timestamp(new Date(Date.parse(NOW) + days * 86_400_000).toISOString());

export const proposalOf = (
  content: string,
  overrides: Partial<MemoryProposal> = {},
): MemoryProposal => ({
  content,
  source: 'user_stated',
  tags: [],
  statedExplicitly: false,
  salience: 0.5,
  ...overrides,
});

export const memoryOf = (
  content: string,
  subject: MemorySubject,
  overrides: Partial<Memory> = {},
): Memory => {
  const policy = policyFor(subject);
  return {
    id: `mem-${content.slice(0, 8)}` as Memory['id'],
    userId: 'user-1' as Memory['userId'],
    companionId: 'companion-1' as Memory['companionId'],
    type: policy.defaultType,
    subject,
    content,
    createdAt: at(0),
    importance: importance(policy.baseImportance),
    confidence: confidence(0.8),
    valence: valence(0),
    source: 'user_stated',
    expiresAt: policy.ttlDays === null ? null : at(policy.ttlDays),
    reinforcementCount: 0,
    lastReinforcedAt: null,
    tags: [],
    relatedTo: [],
    embedding: null,
    metadata: {},
    ...overrides,
  };
};

export const prefs = defaultPreferences;
