import type { ConfidenceScore, ObservationState, WorldObjectId, WorldObjectType } from '@nexa/models';
import type { EventEnvelope } from '../../interfaces/envelope.js';
import { defineEvent } from '../../interfaces/envelope.js';

/**
 * Facts about what the companion understands to be in the user's space.
 *
 * The durable counterpart to `nexa.perception.*`. Perception is raw sensor
 * signal at frame rate and is never logged; these are considered beliefs,
 * written at human pace after aggregation, and they *are* logged.
 * `03_Companion_Core.md` draws exactly this line — the client observes the
 * world, the core understands it — and the split between the two event families
 * is where that line becomes enforceable rather than aspirational.
 *
 * No coordinates leave the backend in an action, but they are legitimate here:
 * this is the companion's own model of a space, not an instruction to a client.
 */

export interface WorldUpdatedPayload {
  readonly aspect: 'location' | 'device' | 'environment' | 'layout';
  readonly summary: string;
  readonly confidence: ConfidenceScore;
}

/**
 * The user moved to a different named space.
 *
 * Location as the user thinks of it — "the kitchen" — not a coordinate. Spaces
 * are the anchors for location-scoped memory, which is what makes "we talked
 * about this at your desk" expressible.
 */
export interface LocationChangedPayload {
  readonly spaceId: WorldObjectId | null;
  readonly label: string;
  readonly previousLabel: string | null;
  readonly confidence: ConfidenceScore;
}

/**
 * An object's status in the world model changed.
 *
 * Carries `observationState` because the difference between "it is there" and
 * "it was there and I have not looked since" is the difference between a
 * helpful reference and a confident lie. A companion asserting the position of
 * a cup someone carried off two hours ago is the failure this field prevents.
 */
export interface ObjectObservedPayload {
  readonly objectId: WorldObjectId;
  readonly objectType: WorldObjectType;
  readonly label: string;
  readonly observationState: ObservationState;
  readonly confidence: ConfidenceScore;
}

export const worldUpdated = defineEvent<'nexa.world.updated', WorldUpdatedPayload>(
  'nexa.world.updated',
  1,
  { source: 'world' },
);

export const locationChanged = defineEvent<'nexa.world.location.changed', LocationChangedPayload>(
  'nexa.world.location.changed',
  1,
  { source: 'world' },
);

export const objectObserved = defineEvent<'nexa.world.object.observed', ObjectObservedPayload>(
  'nexa.world.object.observed',
  1,
  { source: 'world' },
);

export type WorldEvent =
  | EventEnvelope<'nexa.world.updated', WorldUpdatedPayload>
  | EventEnvelope<'nexa.world.location.changed', LocationChangedPayload>
  | EventEnvelope<'nexa.world.object.observed', ObjectObservedPayload>;

export const WORLD_EVENTS = [worldUpdated, locationChanged, objectObserved] as const;
