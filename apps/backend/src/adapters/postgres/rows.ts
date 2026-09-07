import type { CompanionId, InsightId, MemoryId, RelationshipId, UserId } from '@nexa/shared';
import type { Insight, Memory, Relationship, Timestamp } from '@nexa/models';

/**
 * Row ↔ entity mapping, kept in one file.
 *
 * The only interesting thing here is time. `Timestamp` is a branded string
 * validated as ISO 8601 UTC *with milliseconds*, and `timestamptz` round-trips
 * through `Date.toISOString()` in exactly that shape — so nothing is lost as
 * long as every read goes through {@link iso} rather than stringifying a row
 * value directly.
 *
 * Everything else is a straight column, except the bounded nested structures
 * (`supporting`, `history`, `counters`, …) which are `jsonb`. They are never
 * filtered on, so columns would buy nothing and cost a join.
 */

/** A `timestamptz` column as the domain's `Timestamp`. */
export const iso = (value: Date | string | null): Timestamp | null => {
  if (value === null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return date.toISOString() as Timestamp;
};

/** Same, for a column the schema declares `not null`. */
export const isoRequired = (value: Date | string): Timestamp => iso(value) as Timestamp;

export const toMemory = (row: Record<string, unknown>): Memory => ({
  id: row['id'] as MemoryId,
  userId: row['user_id'] as UserId,
  companionId: row['companion_id'] as CompanionId,
  type: row['type'] as Memory['type'],
  subject: row['subject'] as Memory['subject'],
  content: row['content'] as string,
  createdAt: isoRequired(row['created_at'] as Date),
  importance: Number(row['importance']) as Memory['importance'],
  confidence: Number(row['confidence']) as Memory['confidence'],
  valence: Number(row['valence']) as Memory['valence'],
  source: row['source'] as Memory['source'],
  expiresAt: iso(row['expires_at'] as Date | null),
  reinforcementCount: Number(row['reinforcement_count']),
  lastReinforcedAt: iso(row['last_reinforced_at'] as Date | null),
  tags: (row['tags'] ?? []) as readonly string[],
  relatedTo: (row['related_to'] ?? []) as readonly MemoryId[],
  // Absent until Step 3 embeds it. All four columns move together, so the
  // vector id alone decides whether there is a reference at all.
  embedding:
    row['embedding_vector_id'] === null || row['embedding_vector_id'] === undefined
      ? null
      : {
          vectorId: row['embedding_vector_id'] as string,
          model: row['embedding_model'] as string,
          dimensions: Number(row['embedding_dimensions']),
          embeddedAt: isoRequired(row['embedding_at'] as Date),
        },
  metadata: (row['metadata'] ?? {}) as Memory['metadata'],
});

export const memoryValues = (memory: Memory, companionId: CompanionId): readonly unknown[] => [
  memory.id,
  companionId,
  memory.userId,
  memory.type,
  memory.subject,
  memory.content,
  memory.createdAt,
  memory.importance,
  memory.confidence,
  memory.valence,
  memory.source,
  memory.expiresAt,
  memory.reinforcementCount,
  memory.lastReinforcedAt,
  JSON.stringify(memory.tags),
  JSON.stringify(memory.relatedTo),
  memory.embedding?.vectorId ?? null,
  memory.embedding?.model ?? null,
  memory.embedding?.dimensions ?? null,
  memory.embedding?.embeddedAt ?? null,
  JSON.stringify(memory.metadata),
];

export const toInsight = (row: Record<string, unknown>): Insight => ({
  id: row['id'] as InsightId,
  userId: row['user_id'] as UserId,
  companionId: row['companion_id'] as CompanionId,
  key: row['key'] as Insight['key'],
  kind: row['kind'] as Insight['kind'],
  topicKey: row['topic_key'] as string,
  topic: row['topic'] as string,
  polarity: row['polarity'] as Insight['polarity'],
  statement: row['statement'] as string,
  status: row['status'] as Insight['status'],
  certainty: row['certainty'] as Insight['certainty'],
  confidence: Number(row['confidence']) as Insight['confidence'],
  evidenceConfidence: Number(row['evidence_confidence']) as Insight['evidenceConfidence'],
  stability: Number(row['stability']),
  supporting: (row['supporting'] ?? []) as Insight['supporting'],
  opposing: (row['opposing'] ?? []) as Insight['opposing'],
  createdAt: isoRequired(row['created_at'] as Date),
  updatedAt: isoRequired(row['updated_at'] as Date),
  lastSupportedAt: isoRequired(row['last_supported_at'] as Date),
  expiresAt: iso(row['expires_at'] as Date | null),
  revision: Number(row['revision']),
  supersedes: (row['supersedes'] ?? null) as InsightId | null,
  supersededBy: (row['superseded_by'] ?? null) as InsightId | null,
  retirement: (row['retirement'] ?? null) as Insight['retirement'],
  provenance: (row['provenance'] ?? {}) as Insight['provenance'],
  history: (row['history'] ?? []) as Insight['history'],
});

export const insightValues = (insight: Insight): readonly unknown[] => [
  insight.id,
  insight.companionId,
  insight.userId,
  insight.key,
  insight.kind,
  insight.topicKey,
  insight.topic,
  insight.polarity,
  insight.statement,
  insight.status,
  insight.certainty,
  insight.confidence,
  insight.evidenceConfidence,
  insight.stability,
  insight.createdAt,
  insight.updatedAt,
  insight.lastSupportedAt,
  insight.expiresAt,
  insight.revision,
  insight.supersedes,
  insight.supersededBy,
  JSON.stringify(insight.supporting),
  JSON.stringify(insight.opposing),
  JSON.stringify(insight.history),
  insight.retirement === null ? null : JSON.stringify(insight.retirement),
  JSON.stringify(insight.provenance),
];

export const toRelationship = (row: Record<string, unknown>): Relationship => ({
  id: row['id'] as RelationshipId,
  userId: row['user_id'] as UserId,
  companionId: row['companion_id'] as CompanionId,
  type: row['type'] as Relationship['type'],
  dimensions: row['dimensions'] as Relationship['dimensions'],
  interactionCount: Number(row['interaction_count']),
  firstMetAt: isoRequired(row['first_met_at'] as Date),
  lastInteractionAt: isoRequired(row['last_interaction_at'] as Date),
  inferredStyle: (row['inferred_style'] ?? null) as Relationship['inferredStyle'],
  boundaries: (row['boundaries'] ?? []) as readonly string[],
  counters: row['counters'] as Relationship['counters'],
  metadata: (row['metadata'] ?? {}) as Relationship['metadata'],
});

export const relationshipValues = (relationship: Relationship): readonly unknown[] => [
  relationship.id,
  relationship.companionId,
  relationship.userId,
  relationship.type,
  JSON.stringify(relationship.dimensions),
  relationship.interactionCount,
  relationship.firstMetAt,
  relationship.lastInteractionAt,
  relationship.inferredStyle,
  JSON.stringify(relationship.boundaries),
  JSON.stringify(relationship.counters),
  JSON.stringify(relationship.metadata),
];
