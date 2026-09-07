import type { ActionType } from './action.js';

/**
 * The vocabulary a capability's preconditions are stated in.
 *
 * Its own file because both halves of the capability story need it and neither
 * owns it: `CapabilityStatement` (what the companion claims it can do) declares
 * requirements, and `SelfState` (what it can presently do) resolves them. Put
 * in either, the other has to import back and the two form a cycle.
 */

/**
 * A faculty the companion may or may not have.
 *
 * Deliberately *not* `PortKey`. `PortKey` lives in `@nexa/core`, which sits
 * above this package, so naming it here would invert the dependency arrows the
 * whole layout depends on. They are also not the same idea: a port is a wiring
 * detail, a faculty is something the companion can be said to have. `vision` is
 * a faculty long before any port implements it, and representing that gap is
 * most of what the Self Model is for.
 *
 * The composition root maps faculties onto the ports it actually wired. This
 * package never discovers that for itself.
 */
export type FacultyKey =
  | 'speech_out'
  | 'speech_in'
  | 'hearing'
  | 'vision'
  | 'locomotion'
  | 'attention'
  | 'gesture'
  | 'long_term_memory'
  | 'world_model'
  | 'planning'
  | 'tools'
  | 'streaming';

export const FACULTY_KEYS = [
  'speech_out',
  'speech_in',
  'hearing',
  'vision',
  'locomotion',
  'attention',
  'gesture',
  'long_term_memory',
  'world_model',
  'planning',
  'tools',
  'streaming',
] as const satisfies readonly FacultyKey[];

/** Physical hardware a capability may depend on. */
export type DeviceKind =
  | 'microphone'
  | 'speaker'
  | 'camera'
  | 'display'
  | 'headset'
  | 'controller';

export const DEVICE_KINDS = [
  'microphone',
  'speaker',
  'camera',
  'display',
  'headset',
  'controller',
] as const satisfies readonly DeviceKind[];

/**
 * One precondition for a capability.
 *
 * A discriminated union rather than the bare strings this replaces. The old
 * `requires: readonly string[]` held values like `'world_port'` and
 * `'streaming_provider'` that matched no symbol anywhere and were checked by
 * nothing — a catalogue entry could require a faculty that had never existed
 * and no compiler would notice. Each variant here is resolved against a
 * different authority, which is exactly why they cannot be one string type:
 *
 * - `faculty` — is the backend faculty composed and healthy? The composition
 *   root knows.
 * - `action` — can this session's client render it, and can the body presently
 *   perform it? The client declaration and the body report know.
 * - `device` — is the hardware connected and permitted? The client knows.
 */
export type CapabilityRequirement =
  | { readonly kind: 'faculty'; readonly faculty: FacultyKey }
  | { readonly kind: 'action'; readonly action: ActionType }
  | { readonly kind: 'device'; readonly device: DeviceKind };

/** Convenience constructors, so a catalogue entry reads as a sentence. */
export const needsFaculty = (faculty: FacultyKey): CapabilityRequirement => ({
  kind: 'faculty',
  faculty,
});

export const needsAction = (action: ActionType): CapabilityRequirement => ({
  kind: 'action',
  action,
});

export const needsDevice = (device: DeviceKind): CapabilityRequirement => ({
  kind: 'device',
  device,
});
