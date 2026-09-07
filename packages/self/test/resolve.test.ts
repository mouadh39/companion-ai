import { describe, expect, it } from "vitest";
import type {
  BodyState,
  CapabilityStatement,
  ClientCapabilities,
  DeviceDescriptor,
  IdentityProfile,
  SkillDescriptor,
  Timestamp,
} from "@nexa/models";
import { needsAction, needsDevice, needsFaculty } from "@nexa/models";
import type { CompanionId } from "@nexa/shared";
import type { FacultyFacts, ResolveRequest } from "../dist/index.js";
import { resolveSelf } from "../dist/index.js";

/**
 * The Self Model's whole job is to be honest about six different kinds of "no".
 *
 * Every test here exists because collapsing two of them produces a specific
 * lie. The one that matters most is the last group: a client reporting a camera
 * must not be able to make the companion claim it can see.
 */

const AT = "2026-08-29T12:00:00.000Z" as Timestamp;
const COMPANION = "companion-1" as CompanionId;

const statement = (
  over: Partial<CapabilityStatement> = {},
): CapabilityStatement => ({
  id: "cap",
  domain: "perception",
  maturity: "available",
  summary: "A capability.",
  requires: [],
  ...over,
});

/** A profile carrying only the capabilities a test cares about. */
const identityWith = (
  capabilities: readonly CapabilityStatement[],
): IdentityProfile => ({
  name: "Nexa",
  role: "companion",
  mission: "m",
  purpose: [],
  values: [],
  commitments: [],
  autonomy: [],
  capabilities,
  limitations: [],
  knowledgeBoundaries: [],
  uncertainty: [],
  invariants: [],
  version: 1,
  revisedAt: AT,
});

const body = (over: Partial<BodyState> = {}): BodyState => ({
  activity: "idle",
  following: null,
  canPerform: ["move", "look", "gesture", "follow", "stop"],
  recentOutcomes: [],
  observedAt: AT,
  stale: false,
  ...over,
});

const client = (
  over: Partial<ClientCapabilities> = {},
): ClientCapabilities => ({
  actions: ["speak", "move", "look", "gesture", "follow", "stop"],
  streaming: false,
  locale: null,
  ...over,
});

const faculties = (over: Partial<FacultyFacts> = {}): FacultyFacts => ({
  composed: [
    "speech_out",
    "speech_in",
    "locomotion",
    "attention",
    "gesture",
    "long_term_memory",
  ],
  unhealthy: [],
  clientProvidable: [],
  ...over,
});

const camera = (status: DeviceDescriptor["status"]): DeviceDescriptor => ({
  id: "cam-0",
  kind: "camera",
  label: "Front camera",
  status,
  provides: ["vision"],
  observedAt: AT,
});

const request = (over: Partial<ResolveRequest> = {}): ResolveRequest => ({
  companionId: COMPANION,
  identity: identityWith([statement()]),
  faculties: faculties(),
  client: client(),
  body: body(),
  devices: [],
  skills: [],
  at: AT,
  ...over,
});

/** The single resolution produced by a one-capability profile. */
const only = (over: Partial<ResolveRequest> = {}) => {
  const state = resolveSelf(request(over));
  const resolution = state.capabilities[0];
  if (resolution === undefined) throw new Error("no capability resolved");
  return resolution;
};

describe("the six states are distinct", () => {
  it("available when nothing stands in the way", () => {
    expect(only()).toMatchObject({
      status: "available",
      reason: null,
      recovery: "none",
    });
  });

  it("unavailable / not_built when nothing implements it", () => {
    // The state that must stay distinguishable from every other "no": this is
    // the one that could later become "not yet".
    expect(
      only({ identity: identityWith([statement({ maturity: "planned" })]) }),
    ).toMatchObject({
      status: "unavailable",
      reason: "not_built",
      recovery: "develop",
    });
  });

  it("unavailable / not_composed when built but not wired into this deployment", () => {
    expect(
      only({
        identity: identityWith([
          statement({ requires: [needsFaculty("vision")] }),
        ]),
      }),
    ).toMatchObject({
      status: "unavailable",
      reason: "not_composed",
      recovery: "configure",
    });
  });

  it("degraded / unhealthy when composed but failing", () => {
    expect(
      only({
        identity: identityWith([
          statement({ requires: [needsFaculty("locomotion")] }),
        ]),
        faculties: faculties({ unhealthy: ["locomotion"] }),
      }),
    ).toMatchObject({
      status: "degraded",
      reason: "unhealthy",
      recovery: "retry",
    });
  });

  it("degraded / partially_built when the mechanism is half finished", () => {
    expect(
      only({ identity: identityWith([statement({ maturity: "partial" })]) }),
    ).toMatchObject({
      status: "degraded",
      reason: "partially_built",
    });
  });

  it("currently_unavailable / device_missing when the hardware is absent", () => {
    expect(
      only({
        identity: identityWith([
          statement({ requires: [needsDevice("camera")] }),
        ]),
        devices: [],
      }),
    ).toMatchObject({
      status: "currently_unavailable",
      reason: "device_missing",
      recovery: "connect_device",
    });
  });

  it("currently_unavailable / device_denied when permission was refused", () => {
    // Distinct from missing: the fix is to say yes, not to buy hardware.
    expect(
      only({
        identity: identityWith([
          statement({ requires: [needsDevice("camera")] }),
        ]),
        devices: [camera("denied")],
      }),
    ).toMatchObject({
      status: "currently_unavailable",
      reason: "device_denied",
    });
  });

  it("unsupported / client_cannot_render when the session cannot receive it", () => {
    expect(
      only({
        identity: identityWith([
          statement({ requires: [needsAction("gesture")] }),
        ]),
        client: client({ actions: ["speak"] }),
      }),
    ).toMatchObject({ status: "unsupported", reason: "client_cannot_render" });
  });

  it("unsupported / body_cannot_perform points at acquiring a skill", () => {
    // "I do not know how to do that" rather than "I cannot do that" — the
    // distinction the whole six-state vocabulary exists for.
    expect(
      only({
        identity: identityWith([
          statement({ requires: [needsAction("gesture")] }),
        ]),
        body: body({ canPerform: ["move"] }),
      }),
    ).toMatchObject({
      status: "unsupported",
      reason: "body_cannot_perform",
      recovery: "acquire_skill",
    });
  });

  it("unknown / no_report when the body has never spoken", () => {
    expect(
      only({
        identity: identityWith([
          statement({ requires: [needsAction("move")] }),
        ]),
        body: null,
      }),
    ).toMatchObject({
      status: "unknown",
      reason: "no_report",
      recovery: "await_report",
    });
  });

  it("unknown when the body has gone stale rather than assuming it still can", () => {
    expect(
      only({
        identity: identityWith([
          statement({ requires: [needsAction("move")] }),
        ]),
        body: body({ stale: true }),
      }),
    ).toMatchObject({ status: "unknown", reason: "no_report" });
  });
});

describe("resolution can only narrow", () => {
  it("a reported camera does NOT grant vision without a composed faculty", () => {
    // The security property the whole design turns on. A client may report a
    // camera, and the camera may be real; with no vision faculty on this side
    // there is nothing to turn frames into understanding, and the companion
    // must not claim to see.
    const resolution = only({
      identity: identityWith([
        statement({
          id: "see",
          maturity: "available",
          requires: [needsFaculty("vision"), needsDevice("camera")],
        }),
      ]),
      devices: [camera("connected")],
      faculties: faculties({ composed: ["locomotion"] }),
    });

    expect(resolution.status).toBe("unavailable");
    expect(resolution.reason).toBe("not_composed");
  });

  it("reports the most fundamental failure first, not the innermost", () => {
    // Nothing built vision AND the camera is missing. Saying "no camera" would
    // send someone to buy hardware for a feature that does not exist.
    const resolution = only({
      identity: identityWith([
        statement({ maturity: "planned", requires: [needsDevice("camera")] }),
      ]),
      devices: [],
    });

    expect(resolution.reason).toBe("not_built");
  });

  it("never reports available for a capability with an unmet requirement", () => {
    const state = resolveSelf(
      request({
        identity: identityWith([
          statement({ id: "a", requires: [needsFaculty("vision")] }),
          statement({ id: "b", requires: [needsDevice("camera")] }),
          statement({ id: "c", requires: [needsAction("gesture")] }),
        ]),
        client: client({ actions: ["speak"] }),
      }),
    );

    expect(state.capabilities.every((c) => c.status !== "available")).toBe(
      true,
    );
  });
});

describe("purity and shape", () => {
  it("is deterministic", () => {
    const input = request();
    expect(resolveSelf(input)).toStrictEqual(resolveSelf(input));
  });

  it("preserves catalogue order, so the rendered prompt is stable", () => {
    const state = resolveSelf(
      request({
        identity: identityWith([
          statement({ id: "first" }),
          statement({ id: "second" }),
          statement({ id: "third" }),
        ]),
      }),
    );

    expect(state.capabilities.map((c) => c.id)).toEqual([
      "first",
      "second",
      "third",
    ]);
  });

  it("carries the identity by reference rather than copying it", () => {
    const identity = identityWith([statement()]);
    expect(resolveSelf(request({ identity })).identity).toBe(identity);
  });

  it("reuses the body report verbatim rather than restating it", () => {
    const reported = body();
    expect(resolveSelf(request({ body: reported })).body).toBe(reported);
  });
});

describe('skills are judged, not merely listed', () => {
  const skill = (over: Partial<SkillDescriptor> = {}): SkillDescriptor => ({
    id: 'wave',
    name: 'Wave',
    description: 'A wave.',
    satisfies: 'gesture',
    parameter: 'wave',
    requires: ['gesture'],
    source: 'builtin',
    version: 1,
    validation: 'validated',
    ...over,
  });

  /** A profile whose gesture capability is usable, so skills can be. */
  const gesturing = (skills: readonly SkillDescriptor[], over: Partial<ResolveRequest> = {}) =>
    resolveSelf(
      request({
        identity: identityWith([
          statement({ id: 'gesture', requires: [needsFaculty('gesture'), needsAction('gesture')] }),
        ]),
        faculties: faculties({ composed: ['gesture'] }),
        skills,
        ...over,
      }),
    );

  it('offers a builtin skill the body can perform', () => {
    const [resolved] = gesturing([skill()]).skills;
    expect(resolved).toMatchObject({ status: 'available', reason: null });
  });

  it('keeps the declaration intact on the resolution', () => {
    const [resolved] = gesturing([skill()]).skills;
    expect(resolved).toMatchObject({
      id: 'wave',
      satisfies: 'gesture',
      parameter: 'wave',
      requires: ['gesture'],
      source: 'builtin',
      version: 1,
    });
  });

  it('refuses a generated skill nothing has validated', () => {
    // Nothing generates skills today. The gate must already hold for when
    // something does.
    const [resolved] = gesturing([
      skill({ source: 'generated', validation: 'unvalidated' }),
    ]).skills;
    expect(resolved).toMatchObject({ status: 'unavailable', reason: 'not_validated' });
  });

  it('allows a generated skill once validated', () => {
    const [resolved] = gesturing([
      skill({ source: 'generated', validation: 'validated' }),
    ]).skills;
    expect(resolved?.status).toBe('available');
  });

  it('refuses a rejected skill whatever its source', () => {
    for (const source of ['builtin', 'authored', 'generated'] as const) {
      const [resolved] = gesturing([skill({ source, validation: 'rejected' })]).skills;
      expect(resolved).toMatchObject({ status: 'unavailable', reason: 'rejected' });
    }
  });

  it('judges trust before ability, so an untrusted skill is refused as untrusted', () => {
    // Whether we *should* use it does not depend on whether we *could*.
    const [resolved] = gesturing([skill({ source: 'generated', validation: 'unvalidated' })], {
      body: body({ canPerform: [] }),
    }).skills;

    expect(resolved?.reason).toBe('not_validated');
  });

  it('refuses a skill whose faculty is not available', () => {
    const [resolved] = resolveSelf(
      request({
        identity: identityWith([statement()]),
        faculties: faculties({ composed: [] }),
        skills: [skill()],
      }),
    ).skills;

    expect(resolved).toMatchObject({ status: 'unavailable', reason: 'faculty_unavailable' });
  });

  it('cannot grant an action the body cannot perform', () => {
    // A declaration does not conjure the action it realises. If the body cannot
    // gesture, declaring a wave changes nothing.
    const [resolved] = gesturing([skill()], { body: body({ canPerform: ['move'] }) }).skills;
    expect(resolved).toMatchObject({ status: 'unavailable', reason: 'action_unavailable' });
  });

  it('loses the skill when the client can no longer render the action', () => {
    const [resolved] = gesturing([skill()], { client: client({ actions: ['speak'] }) }).skills;
    expect(resolved?.status).toBe('unavailable');
  });

  it('agrees with the capability it realises, because it asks the same question', () => {
    // The property that keeps the two from drifting: skill and capability
    // resolution run through the same faculty and action checks.
    const state = gesturing([skill()], { body: body({ canPerform: [] }) });
    expect(state.capabilities[0]?.status).toBe('unsupported');
    expect(state.skills[0]?.status).toBe('unavailable');
  });
});

describe('a client supplies evidence, never permission', () => {
  const mic = (status: DeviceDescriptor['status'] = 'connected'): DeviceDescriptor => ({
    id: 'mic-0',
    kind: 'microphone',
    label: 'Headset microphone',
    status,
    provides: ['speech_in', 'hearing'],
    observedAt: AT,
  });

  it('lets a connected device satisfy a faculty the backend permits', () => {
    // Speech recognition genuinely runs in the client. The backend neither
    // performs nor verifies it, so a connected microphone is what makes
    // hearing possible — and saying so is honest rather than generous.
    const resolution = only({
      identity: identityWith([statement({ requires: [needsFaculty('speech_in')] })]),
      faculties: faculties({ composed: [], clientProvidable: ['speech_in'] }),
      devices: [mic()],
    });

    expect(resolution.status).toBe('available');
  });

  it('refuses a faculty the backend has not marked client-providable', () => {
    // The rule the whole design turns on. The camera may be real and the
    // declaration truthful; turning frames into understanding is work this side
    // would have to do and has not been built.
    const resolution = only({
      identity: identityWith([statement({ requires: [needsFaculty('vision')] })]),
      faculties: faculties({ composed: [], clientProvidable: ['speech_in'] }),
      devices: [
        {
          id: 'cam-0',
          kind: 'camera',
          label: 'Front camera',
          status: 'connected',
          // Declared perfectly truthfully, and it changes nothing.
          provides: ['vision'],
          observedAt: AT,
        },
      ],
    });

    expect(resolution.status).toBe('unavailable');
    expect(resolution.reason).toBe('not_composed');
  });

  it('treats a client-providable faculty with no device as a right-now problem', () => {
    const resolution = only({
      identity: identityWith([statement({ requires: [needsFaculty('speech_in')] })]),
      faculties: faculties({ composed: [], clientProvidable: ['speech_in'] }),
      devices: [],
    });

    // Someone can plug a microphone in. That is a different sentence from
    // "this deployment does not have speech".
    expect(resolution).toMatchObject({
      status: 'currently_unavailable',
      reason: 'device_missing',
      recovery: 'connect_device',
    });
  });

  it('distinguishes a refused microphone from an absent one', () => {
    const resolution = only({
      identity: identityWith([statement({ requires: [needsFaculty('speech_in')] })]),
      faculties: faculties({ composed: [], clientProvidable: ['speech_in'] }),
      devices: [mic('denied')],
    });

    expect(resolution.reason).toBe('device_denied');
  });

  it('does not accept a device that is present but not connected', () => {
    const resolution = only({
      identity: identityWith([statement({ requires: [needsFaculty('speech_in')] })]),
      faculties: faculties({ composed: [], clientProvidable: ['speech_in'] }),
      devices: [mic('unavailable')],
    });

    expect(resolution.status).toBe('currently_unavailable');
  });

  it('still prefers the backend when it composes the faculty itself', () => {
    // A composed faculty needs no hardware permission, and an unhealthy one
    // still reports as failing rather than being rescued by a device.
    const resolution = only({
      identity: identityWith([statement({ requires: [needsFaculty('speech_in')] })]),
      faculties: faculties({
        composed: ['speech_in'],
        unhealthy: ['speech_in'],
        clientProvidable: ['speech_in'],
      }),
      devices: [mic()],
    });

    expect(resolution).toMatchObject({ status: 'degraded', reason: 'unhealthy' });
  });
});
