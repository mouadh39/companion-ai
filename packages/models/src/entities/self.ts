import type { CompanionId } from '@nexa/shared';
import type { ActionType } from './action.js';
import type { BodyState } from './action-outcome.js';
import type { CapabilityDomain, IdentityProfile } from './identity-profile.js';
import type { DeviceKind, FacultyKey } from './faculty.js';
import type { Timestamp } from '../value-objects/timestamp.js';

/**
 * What the companion is, can do, and is doing — as one derived value.
 *
 * The Self Model exists because "what can you do?" had four unconnected
 * answers: a hand-maintained catalogue in `@nexa/identity`, the set of ports
 * the composition root actually wired, what the connected client declared it
 * could render, and what the body reported it could presently perform. Nothing
 * joined them, so the only component in a position to answer the question was
 * the language model — which has access to none of them.
 *
 * This type is that join. It is **derived, immutable, and never stored**:
 * recomputed per turn from sources that are each authoritative about their own
 * layer, and written to by nothing downstream. A `SelfState` in a database
 * would be a `SelfState` that can disagree with the system it describes.
 */

/**
 * How available a capability actually is.
 *
 * Six states rather than a boolean, and the separation is the point. Collapsing
 * them yields a companion that says "I can't" to six different situations that
 * call for six different things to happen next — and, most damagingly, makes
 * *"I cannot do this"* indistinguishable from *"I do not know how to do this
 * yet"*. The second is a thing that could later be learned; the first is not.
 *
 * - `available` — works right now.
 * - `degraded` — exists and is reachable, but impaired. Usable with caution.
 * - `currently_unavailable` — built and wired, but something transient is
 *   missing: a device unplugged, a permission refused. Recoverable without code.
 * - `unavailable` — not present in this deployment at all. Either never built
 *   or not composed in. Recoverable by development or configuration.
 * - `unsupported` — this particular body or client cannot do it, however well
 *   the backend is configured. Recoverable only by a different body, or by
 *   acquiring a skill.
 * - `unknown` — nothing has reported. The companion genuinely does not know,
 *   and saying so is the honest answer rather than guessing either way.
 */
export type CapabilityStatus =
  | 'available'
  | 'degraded'
  | 'currently_unavailable'
  | 'unavailable'
  | 'unsupported'
  | 'unknown';

export const CAPABILITY_STATUSES = [
  'available',
  'degraded',
  'currently_unavailable',
  'unavailable',
  'unsupported',
  'unknown',
] as const satisfies readonly CapabilityStatus[];

/**
 * Precisely why a capability is not simply available.
 *
 * The field anything downstream is allowed to branch on. `summary` is prose for
 * a person to read and will be reworded; a rule keyed on prose breaks silently
 * the first time someone improves a sentence.
 */
export type CapabilityReason =
  /** No implementation exists anywhere. Nobody has built this yet. */
  | 'not_built'
  /** Built, but partially — the mechanism exists and something it needs does not. */
  | 'partially_built'
  /** Implemented, but this deployment did not compose it in. */
  | 'not_composed'
  /** Composed, but its provider is reporting failure. */
  | 'unhealthy'
  /** Needs a device that is not connected. */
  | 'device_missing'
  /** The device exists but permission to use it was refused. */
  | 'device_denied'
  /** The connected client cannot render this kind of action at all. */
  | 'client_cannot_render'
  /** The body is present but has no way to perform it — no clip, no component. */
  | 'body_cannot_perform'
  /** Nothing has reported yet, so availability is genuinely not known. */
  | 'no_report';

export const CAPABILITY_REASONS = [
  'not_built',
  'partially_built',
  'not_composed',
  'unhealthy',
  'device_missing',
  'device_denied',
  'client_cannot_render',
  'body_cannot_perform',
  'no_report',
] as const satisfies readonly CapabilityReason[];

/**
 * What would have to happen for a capability to become available.
 *
 * Carried alongside the reason because the reason says what is wrong and this
 * says what kind of thing would fix it — which is the part that matters for
 * anything the companion might later do about it.
 *
 * `acquire_skill` is the one to note. It marks the case where the body is
 * otherwise fine and simply lacks a way to perform this particular thing, and
 * it is the hook a future skill registry would attach to. **Nothing generates
 * skills today**, and this value grants no such ability; it only makes the
 * situation nameable, so that "I don't know how to do that yet" stops being
 * indistinguishable from "I cannot do that".
 */
export type CapabilityRecovery =
  /** Nothing to fix. */
  | 'none'
  /** Transient; trying again later may work. */
  | 'retry'
  /** Someone must connect or permit a device. */
  | 'connect_device'
  /** An operator must compose the faculty into this deployment. */
  | 'configure'
  /** The body would need a skill it does not have. */
  | 'acquire_skill'
  /** Somebody has to build it. Not something the companion can bring about. */
  | 'develop'
  /** The answer is unknown until something reports. */
  | 'await_report';

export const CAPABILITY_RECOVERIES = [
  'none',
  'retry',
  'connect_device',
  'configure',
  'acquire_skill',
  'develop',
  'await_report',
] as const satisfies readonly CapabilityRecovery[];

/** One capability, resolved against everything currently known. */
export interface CapabilityResolution {
  /** Matches `CapabilityStatement.id` in the identity catalogue. */
  readonly id: string;
  readonly domain: CapabilityDomain;
  readonly status: CapabilityStatus;
  /** Null exactly when `status` is `available`. */
  readonly reason: CapabilityReason | null;
  readonly recovery: CapabilityRecovery;
  /** The catalogue's own words. For rendering, never for branching. */
  readonly summary: string;
}

/** True when the companion may speak of this capability in the present tense. */
export const isUsable = (resolution: CapabilityResolution): boolean =>
  resolution.status === 'available' || resolution.status === 'degraded';

/**
 * A device the client has told us about.
 *
 * Reported by the client, because only the client can see what is plugged into
 * it. **A device report alone never grants a capability** — see
 * `resolveCapabilities` — because a client that could grant itself faculties by
 * asserting hardware would be a client that can make the companion claim to
 * see. A device is one necessary condition among several.
 */
export interface DeviceDescriptor {
  readonly id: string;
  readonly kind: DeviceKind;
  /** What a person would call it. Never a path, endpoint, key or serial. */
  readonly label: string;
  readonly status: DeviceStatus;
  /** Faculties this device is a precondition for. */
  readonly provides: readonly FacultyKey[];
  readonly observedAt: Timestamp;
}

export type DeviceStatus = 'connected' | 'unavailable' | 'denied' | 'unknown';

export const DEVICE_STATUSES = [
  'connected',
  'unavailable',
  'denied',
  'unknown',
] as const satisfies readonly DeviceStatus[];

/**
 * One way of performing something, as the body declares it.
 *
 * A capability is *what* the companion can do; a skill is *how* one particular
 * performance of it is realised. `gesture` is a capability; `wave` is a skill.
 * The distinction earns its place because the body is the only thing that knows
 * which clips its rig actually has, and without this the answer to "can you
 * wave?" is only discoverable by trying and being told `unsupported`.
 *
 * `source` and `validation` exist so a future generated skill has somewhere
 * honest to sit. **No skill is generated today**, nothing in this codebase
 * writes a `generated` descriptor, and a descriptor that is not `validated` may
 * never be reported as usable.
 */
export interface SkillDescriptor {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  /** The action vocabulary entry this realises. */
  readonly satisfies: ActionType;
  /** The specific variant, where the action takes one — a gesture kind, say. */
  readonly parameter: string | null;
  readonly requires: readonly FacultyKey[];
  readonly source: SkillSource;
  readonly version: number;
  readonly validation: SkillValidation;
}

/**
 * Where a skill came from, which decides how far it is trusted.
 *
 * `builtin` ships with the body. `authored` was configured by a person.
 * `generated` would be produced by a future system and is listed here only so
 * that such a skill cannot be mistaken for one of the first two.
 */
export type SkillSource = 'builtin' | 'authored' | 'generated';

export const SKILL_SOURCES = [
  'builtin',
  'authored',
  'generated',
] as const satisfies readonly SkillSource[];

export type SkillValidation = 'unvalidated' | 'validated' | 'rejected';

export const SKILL_VALIDATIONS = [
  'unvalidated',
  'validated',
  'rejected',
] as const satisfies readonly SkillValidation[];

/**
 * Why a declared skill cannot be used.
 *
 * Separate from `CapabilityReason` because the questions differ. A capability
 * asks *"does this faculty exist here?"*; a skill asks *"is this particular way
 * of doing it trustworthy and presently performable?"* — and the answers a
 * person cares about are different: "you have hands but no wave animation" is
 * not the same admission as "you have no body".
 */
export type SkillReason =
  /** Something judged it unfit. Terminal. */
  | 'rejected'
  /** Generated, and nothing has validated it. Not trusted, not offered. */
  | 'not_validated'
  /** A faculty the skill needs is not available. */
  | 'faculty_unavailable'
  /** The body or client cannot perform the action this skill realises. */
  | 'action_unavailable';

export const SKILL_REASONS = [
  'rejected',
  'not_validated',
  'faculty_unavailable',
  'action_unavailable',
] as const satisfies readonly SkillReason[];

export type SkillStatus = 'available' | 'unavailable';

export const SKILL_STATUSES = [
  'available',
  'unavailable',
] as const satisfies readonly SkillStatus[];

/**
 * A declared skill, judged against everything currently known.
 *
 * Carries the declaration unchanged and adds the two fields the body is not
 * entitled to decide. A client says *what it has*; whether that may be offered
 * depends on validation policy and on whether the underlying capability is
 * usable at all, and neither of those is the client's call.
 *
 * Kept in the state even when unavailable, rather than filtered out, because
 * "you have the gesture faculty but no wave animation" is a sentence the
 * companion should be able to say — and it cannot say it about a skill that was
 * silently dropped.
 */
export interface SkillResolution extends SkillDescriptor {
  readonly status: SkillStatus;
  /** Null exactly when `status` is `available`. */
  readonly reason: SkillReason | null;
}

/**
 * Whether a skill may be offered.
 *
 * A `generated` skill must be `validated` first; anything else is refused. This
 * is the gate that keeps a future generation pipeline from being able to make
 * the companion attempt motion nothing has checked, and it is enforced here —
 * in the domain — rather than in whichever component happens to read the
 * registry.
 */
export const isOfferable = (skill: SkillDescriptor): boolean =>
  skill.validation !== 'rejected' &&
  (skill.source !== 'generated' || skill.validation === 'validated');

/**
 * Everything the companion can truthfully say about itself right now.
 *
 * The authoritative answer, assembled from four sources that are each
 * authoritative about their own layer and none of which can overrule another's.
 * Generation reads it; nothing writes it.
 */
export interface SelfState {
  readonly companionId: CompanionId;
  /**
   * The frozen, versioned self-definition.
   *
   * Carried by reference. It is a constant, so this costs nothing, and it means
   * a `SelfState` is self-describing when replayed — the identity that was in
   * force travels with the state it produced.
   */
  readonly identity: IdentityProfile;
  readonly capabilities: readonly CapabilityResolution[];
  readonly devices: readonly DeviceDescriptor[];
  readonly skills: readonly SkillResolution[];
  /**
   * What the body reported. Null when no embodiment capability is composed.
   *
   * Reused verbatim from the action-result loop rather than restated, because a
   * second source of truth about the body is a second thing that can be wrong
   * about whether a movement happened.
   */
  readonly body: BodyState | null;
  readonly observedAt: Timestamp;
}

/** Capabilities the companion may describe in the present tense, in catalogue order. */
export const usableCapabilities = (
  state: SelfState,
): readonly CapabilityResolution[] => state.capabilities.filter(isUsable);

/** Capabilities it must not claim, in catalogue order. */
export const unusableCapabilities = (
  state: SelfState,
): readonly CapabilityResolution[] =>
  state.capabilities.filter((resolution) => !isUsable(resolution));

/** Looks a capability up by id. Null when the catalogue has no such entry. */
export const capabilityOf = (
  state: SelfState,
  id: string,
): CapabilityResolution | null =>
  state.capabilities.find((resolution) => resolution.id === id) ?? null;

/** Skills the companion may say it knows how to perform, in declaration order. */
export const usableSkills = (state: SelfState): readonly SkillResolution[] =>
  state.skills.filter((skill) => skill.status === 'available');

/**
 * Capabilities that are usable but have no skill to realise them.
 *
 * The gap that makes *"I can gesture, but I do not know how to wave"* sayable.
 * Without it that situation renders as a plain capability claim, and the
 * companion offers something no clip exists for.
 */
export const capabilitiesLackingSkills = (
  state: SelfState,
  satisfiedBy: (capability: CapabilityResolution) => ActionType | null,
): readonly CapabilityResolution[] =>
  state.capabilities.filter((capability) => {
    if (!isUsable(capability)) return false;

    const action = satisfiedBy(capability);
    if (action === null) return false;

    const declared = state.skills.filter((skill) => skill.satisfies === action);
    if (declared.length === 0) return false;

    return !declared.some((skill) => skill.status === 'available');
  });
