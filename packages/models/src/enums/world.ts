/**
 * What the companion understands to be present in a space.
 *
 * The world model is Nexa's, not Unity's. `03_Companion_Core.md` puts the split
 * plainly: the client *observes* the world, the core *understands* it. So these
 * are semantic categories the companion can reason and speak about — "you left
 * it on the table" — not the mesh classifications a tracking system emits. A
 * client that recognises new geometry maps it into this vocabulary; it does not
 * extend it.
 */
export type WorldObjectType =
  | 'surface'
  | 'furniture'
  | 'device'
  | 'door'
  | 'window'
  | 'person'
  | 'plant'
  | 'unknown';

export const WORLD_OBJECT_TYPES = [
  'surface',
  'furniture',
  'device',
  'door',
  'window',
  'person',
  'plant',
  'unknown',
] as const satisfies readonly WorldObjectType[];

/**
 * A named place, as the user thinks of it.
 *
 * Distinct from `WorldObjectType` because a space is not an object in it.
 * `30_Location_and_Spaces.md` treats these as the anchors for location-scoped
 * memory: "we talked about this in the kitchen" is only expressible if the
 * kitchen is a thing the companion can name.
 */
export type SpaceType = 'room' | 'desk' | 'outdoor' | 'vehicle' | 'unknown';

export const SPACE_TYPES = [
  'room',
  'desk',
  'outdoor',
  'vehicle',
  'unknown',
] as const satisfies readonly SpaceType[];

/**
 * How current the companion's belief about an object is.
 *
 * AR tracking is intermittent — objects leave view, sessions relocalise, and
 * the world model must keep believing in a table it can no longer see. This
 * distinguishes "it is there" from "it was there and I have not looked since",
 * which is the difference between a helpful reference and a confident lie.
 */
export type ObservationState = 'observed' | 'remembered' | 'stale' | 'gone';

export const OBSERVATION_STATES = [
  'observed',
  'remembered',
  'stale',
  'gone',
] as const satisfies readonly ObservationState[];

/** True when the companion may refer to the object as presently there. */
export const isPresent = (state: ObservationState): boolean =>
  state === 'observed' || state === 'remembered';
