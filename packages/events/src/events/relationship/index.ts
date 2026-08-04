import type { RelationshipDimension, RelationshipId, RelationshipType } from '@nexa/models';
import type { EventEnvelope } from '../../interfaces/envelope.js';
import { defineEvent } from '../../interfaces/envelope.js';

/**
 * Facts about how the companion and the user stand with each other.
 *
 * One parameterised event covers what the brief listed as `TrustChanged` and
 * `FamiliarityChanged`. The accepted `Event_API.md` already specifies
 * `nexa.relationship.updated { dimension }`, and the parameterised form is the
 * better design regardless: `@nexa/models` defines four dimensions, so
 * per-dimension events would mean four types today and a new type — plus a new
 * subscription everywhere — each time a fifth is added.
 *
 * A consumer that only cares about trust filters on `payload.dimension`, which
 * is exactly what `SubscribeOptions.filter` is for.
 *
 * **These events are order-sensitive.** Trust is accumulative, so applying two
 * updates out of sequence yields a different value. Per-companion ordering is
 * guaranteed by partitioning on `companionId`; nothing here may rely on
 * ordering relative to another aggregate.
 */

export interface RelationshipUpdatedPayload {
  readonly relationshipId: RelationshipId;
  readonly dimension: RelationshipDimension;
  readonly previous: number;
  readonly current: number;
  /** What moved it. Interaction count, an apology, a boundary being respected. */
  readonly cause: string;
}

/**
 * The overall stage advanced or regressed.
 *
 * Separate from a dimension change because it is a discrete, rare, and
 * behaviourally significant event: crossing into `familiar` is what licenses
 * the companion to use shorthand and reference shared history. Regression is
 * possible and deliberate — a relationship that only ever advances is a counter,
 * not a relationship.
 */
export interface RelationshipStageChangedPayload {
  readonly relationshipId: RelationshipId;
  readonly previous: RelationshipType;
  readonly current: RelationshipType;
  readonly interactionCount: number;
}

export const relationshipUpdated = defineEvent<
  'nexa.relationship.updated',
  RelationshipUpdatedPayload
>('nexa.relationship.updated', 1, { source: 'relationship' });

export const relationshipStageChanged = defineEvent<
  'nexa.relationship.stage.changed',
  RelationshipStageChangedPayload
>('nexa.relationship.stage.changed', 1, { source: 'relationship' });

export type RelationshipEvent =
  | EventEnvelope<'nexa.relationship.updated', RelationshipUpdatedPayload>
  | EventEnvelope<'nexa.relationship.stage.changed', RelationshipStageChangedPayload>;

export const RELATIONSHIP_EVENTS = [relationshipUpdated, relationshipStageChanged] as const;
