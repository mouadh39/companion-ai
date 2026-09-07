import type {
  ActionType,
  BodyState,
  CapabilityRecovery,
  CapabilityReason,
  CapabilityRequirement,
  CapabilityResolution,
  CapabilityStatement,
  CapabilityStatus,
  ClientCapabilities,
  DeviceDescriptor,
  DeviceKind,
  FacultyKey,
  IdentityProfile,
  SelfState,
  SkillDescriptor,
  SkillReason,
  SkillResolution,
  SkillStatus,
  Timestamp,
} from '@nexa/models';
import { isOfferable } from '@nexa/models';
import type { CompanionId } from '@nexa/shared';

/**
 * Resolving what the companion can actually do.
 *
 * Pure and total: same inputs, same output, no clock, no I/O, no throw. That is
 * what lets a `SelfState` be recomputed identically during replay, and what
 * keeps this out of the latency path — the composition root has already fetched
 * every input by the time this runs.
 *
 * ## The one rule
 *
 * **Resolution can only ever narrow.** Every check below can move a capability
 * further from `available` and none can move it closer. That is the property
 * that makes a hostile or buggy client harmless: a client may report a camera,
 * and the camera may be perfectly real, but if no `vision` faculty is composed
 * into this deployment the capability still resolves `unavailable`. Nothing a
 * client says can conjure a faculty the backend does not have, and nothing the
 * language model says reaches this function at all.
 */

/**
 * Which faculties this deployment actually wired, and how they are faring.
 *
 * Supplied by the composition root, which is the only component that knows what
 * it composed. This package deliberately cannot discover it: a self model that
 * inspected the running system would be a self model that drifts from the
 * wiring the moment either changes.
 */
export interface FacultyFacts {
  /** Faculties whose backing port is composed in. */
  readonly composed: readonly FacultyKey[];
  /**
   * Composed faculties whose provider is currently reporting failure.
   *
   * Separate from `composed` rather than removing them from it, because
   * "configured and broken" and "never configured" call for different answers —
   * the first is worth retrying, the second is not.
   */
  readonly unhealthy: readonly FacultyKey[];
  /**
   * Faculties the backend accepts a *client* as being able to supply.
   *
   * This list is the whole trust model, and it belongs to the backend on
   * purpose. Speech is the honest case for it: recognition and synthesis run
   * entirely in the client, this process neither performs nor verifies them,
   * and a connected microphone genuinely is what makes hearing possible. So
   * `speech_in` is listed, and a reported microphone satisfies it.
   *
   * **A device's own `provides` list is only consulted for faculties named
   * here.** That asymmetry is what stops a client granting itself sight: a
   * camera may declare `provides: ['vision']` perfectly truthfully, but
   * `vision` is not client-providable — turning frames into understanding is
   * work this side would have to do and has not been built — so the capability
   * still resolves `not_composed`. The client supplies evidence about its
   * environment; it never supplies permission.
   */
  readonly clientProvidable: readonly FacultyKey[];
}

export interface ResolveRequest {
  readonly companionId: CompanionId;
  readonly identity: IdentityProfile;
  readonly faculties: FacultyFacts;
  /** What the connected client declared. Null when it declared nothing. */
  readonly client: ClientCapabilities | null;
  /** What the body last reported. Null when no embodiment capability exists. */
  readonly body: BodyState | null;
  readonly devices: readonly DeviceDescriptor[];
  readonly skills: readonly SkillDescriptor[];
  readonly at: Timestamp;
}

/** The verdict for one capability, before it is dressed up as a resolution. */
interface Verdict {
  readonly status: CapabilityStatus;
  readonly reason: CapabilityReason | null;
  readonly recovery: CapabilityRecovery;
}

const AVAILABLE: Verdict = { status: 'available', reason: null, recovery: 'none' };

/**
 * Assembles everything the companion can truthfully say about itself.
 *
 * The identity is carried by reference rather than summarised. It is a frozen
 * constant, so this costs nothing, and it means a replayed `SelfState` is
 * self-describing: the identity that was in force travels with the state it
 * produced.
 */
export const resolveSelf = (request: ResolveRequest): SelfState => ({
  companionId: request.companionId,
  identity: request.identity,
  capabilities: resolveCapabilities(request),
  devices: request.devices,
  skills: resolveSkills(request),
  body: request.body,
  observedAt: request.at,
});

/**
 * Resolves every catalogue entry, in catalogue order.
 *
 * Order is preserved so the rendered prompt is stable turn to turn, which is
 * what lets the section participate in prompt caching instead of defeating it.
 */
export const resolveCapabilities = (
  request: ResolveRequest,
): readonly CapabilityResolution[] =>
  request.identity.capabilities.map((statement) => {
    const verdict = judge(statement, request);

    return {
      id: statement.id,
      domain: statement.domain,
      status: verdict.status,
      reason: verdict.reason,
      recovery: verdict.recovery,
      summary: statement.summary,
    };
  });

/**
 * Decides one capability's fate.
 *
 * Checks run from most fundamental to most local, and **the first failure
 * wins**. That ordering is deliberate: if nothing has built vision, saying so is
 * more useful than reporting that the camera is also unplugged. Reporting the
 * innermost cause would send someone to buy hardware for a feature that does not
 * exist.
 */
const judge = (
  statement: CapabilityStatement,
  request: ResolveRequest,
): Verdict => {
  // 1. Nothing built it. No amount of configuration or hardware helps, and this
  //    is the case that must stay distinguishable from every other "no" — it is
  //    the one that could later become "not yet".
  if (statement.maturity === 'planned') {
    return { status: 'unavailable', reason: 'not_built', recovery: 'develop' };
  }

  // 2–4. Requirements, in the order their authorities are consulted.
  for (const requirement of statement.requires) {
    const failure = check(requirement, request);
    if (failure !== null) return failure;
  }

  // 5. Everything it needs is present, but the mechanism itself is only half
  //    built. Usable, with the caveat carried rather than dropped.
  if (statement.maturity === 'partial') {
    return { status: 'degraded', reason: 'partially_built', recovery: 'develop' };
  }

  return AVAILABLE;
};

/** Tests one requirement. Null when it holds. */
const check = (
  requirement: CapabilityRequirement,
  request: ResolveRequest,
): Verdict | null => {
  switch (requirement.kind) {
    case 'faculty':
      return checkFaculty(requirement.faculty, request.faculties, request.devices);

    case 'device':
      return checkDevice(requirement.device, request.devices);

    case 'action':
      return checkAction(requirement.action, request);
  }
};

/**
 * Is the faculty available — from the backend, or from a client permitted to
 * supply it?
 *
 * The first gate, and the one that makes device reports safe. Backend
 * composition is checked first; only a faculty the backend has explicitly
 * marked client-providable may be satisfied by hardware instead, and only by a
 * device that is actually connected.
 *
 * A camera reporting `provides: ['vision']` therefore changes nothing while
 * `vision` is absent from `clientProvidable`, because there is nothing on this
 * side to turn frames into understanding.
 */
const checkFaculty = (
  faculty: FacultyKey,
  facts: FacultyFacts,
  devices: readonly DeviceDescriptor[],
): Verdict | null => {
  if (facts.composed.includes(faculty)) {
    if (facts.unhealthy.includes(faculty)) {
      return { status: 'degraded', reason: 'unhealthy', recovery: 'retry' };
    }
    return null;
  }

  if (!facts.clientProvidable.includes(faculty)) {
    return { status: 'unavailable', reason: 'not_composed', recovery: 'configure' };
  }

  // Client-providable: the hardware decides. A missing one is a thing someone
  // can plug in, so it is `currently_unavailable` rather than `unavailable` —
  // a different sentence, and a different thing to do about it.
  const supplying = devices.filter((device) => device.provides.includes(faculty));

  if (supplying.some((device) => device.status === 'connected')) return null;

  if (supplying.some((device) => device.status === 'denied')) {
    return {
      status: 'currently_unavailable',
      reason: 'device_denied',
      recovery: 'connect_device',
    };
  }

  return {
    status: 'currently_unavailable',
    reason: 'device_missing',
    recovery: 'connect_device',
  };
};

/**
 * Is the hardware present and permitted?
 *
 * A device that is absent and one whose permission was refused are separated
 * because they are different requests to the person: plug something in, or say
 * yes. Both are recoverable without code, which is why neither is `unavailable`.
 */
const checkDevice = (
  kind: DeviceKind,
  devices: readonly DeviceDescriptor[],
): Verdict | null => {
  const device = devices.find((candidate) => candidate.kind === kind);

  if (device === undefined || device.status === 'unavailable') {
    return {
      status: 'currently_unavailable',
      reason: 'device_missing',
      recovery: 'connect_device',
    };
  }

  if (device.status === 'denied') {
    return {
      status: 'currently_unavailable',
      reason: 'device_denied',
      recovery: 'connect_device',
    };
  }

  // A device that has never reported leaves the capability genuinely unknown,
  // which is a better answer than assuming either way.
  if (device.status === 'unknown') {
    return { status: 'unknown', reason: 'no_report', recovery: 'await_report' };
  }

  return null;
};

/**
 * Can this client receive the action, and can the body presently perform it?
 *
 * Two different authorities, checked in that order. The client's declaration is
 * a fact about the session; the body's report is a fact about the character in
 * it, and a client that cannot render a gesture at all should be told so rather
 * than asked about clips it will never play.
 *
 * The undeclared case is treated as capable, matching `ClientCapabilities`'
 * own rule that absence of a declaration is not evidence of incapability. That
 * only ever concerns whether the *action* is filtered; the body check below
 * still applies, and a body that has said nothing yields `unknown`.
 */
const checkAction = (
  action: ActionType,
  request: ResolveRequest,
): Verdict | null => {
  const client = request.client;
  if (client !== null && !client.actions.includes(action)) {
    return {
      status: 'unsupported',
      reason: 'client_cannot_render',
      // No recovery this deployment can perform: it would take a different
      // client, which is not something anyone here can bring about.
      recovery: 'none',
    };
  }

  const body = request.body;

  // No embodiment capability at all, or a body that has gone quiet. Either way
  // nothing has told us whether this body can do it, and inventing an answer is
  // exactly what the Self Model exists to stop.
  if (body === null || body.stale) {
    return { status: 'unknown', reason: 'no_report', recovery: 'await_report' };
  }

  if (!body.canPerform.includes(action)) {
    return {
      status: 'unsupported',
      reason: 'body_cannot_perform',
      // The one case a future skill registry would attach to. Nothing acquires
      // skills today; naming the situation is all this does.
      recovery: 'acquire_skill',
    };
  }

  return null;
};

/**
 * Judges every declared skill.
 *
 * Deliberately built on the *same* `checkFaculty` and `checkAction` the
 * capability path uses. A skill is a way of performing an action, so "can this
 * skill be used" and "is that action available" must never be able to disagree
 * — and the only way to guarantee that is to ask the same function rather than
 * write a second rule that looks equivalent today.
 *
 * Declaration order is preserved, and unavailable skills are kept rather than
 * dropped: *"you have the gesture faculty but no wave animation"* is a sentence
 * the companion should be able to say, and it cannot say it about a skill that
 * was silently filtered away.
 */
export const resolveSkills = (request: ResolveRequest): readonly SkillResolution[] =>
  request.skills.map((skill) => {
    const verdict = judgeSkill(skill, request);
    return { ...skill, status: verdict.status, reason: verdict.reason };
  });

interface SkillVerdict {
  readonly status: SkillStatus;
  readonly reason: SkillReason | null;
}

const SKILL_AVAILABLE: SkillVerdict = { status: 'available', reason: null };

/**
 * Whether one skill may be offered.
 *
 * Trust first, then ability. A skill nothing has validated is refused before
 * anything asks whether the body could perform it, because the question of
 * whether we *should* use it does not depend on whether we *could* — and
 * checking ability first would leak the existence of an untrusted skill into
 * the reasoning about a trusted one.
 */
const judgeSkill = (skill: SkillDescriptor, request: ResolveRequest): SkillVerdict => {
  if (skill.validation === 'rejected') {
    return { status: 'unavailable', reason: 'rejected' };
  }

  // The gate that must already hold before anything generates a skill. Nothing
  // does today; when something does, an unvalidated one is refused here rather
  // than in whichever component happens to read the registry.
  if (!isOfferable(skill)) {
    return { status: 'unavailable', reason: 'not_validated' };
  }

  for (const faculty of skill.requires) {
    if (checkFaculty(faculty, request.faculties, request.devices) !== null) {
      return { status: 'unavailable', reason: 'faculty_unavailable' };
    }
  }

  // A declaration cannot conjure the action it realises. If the body cannot
  // gesture, no amount of declaring a wave makes waving possible.
  if (checkAction(skill.satisfies, request) !== null) {
    return { status: 'unavailable', reason: 'action_unavailable' };
  }

  return SKILL_AVAILABLE;
};
