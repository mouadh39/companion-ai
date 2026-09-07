import type { Clock } from '@nexa/shared';
import type { DeviceDescriptor, FacultyKey, SelfState, SkillDescriptor } from '@nexa/models';
import { timestamp } from '@nexa/models';
import type { PortOptions, SelfModelPort, SelfModelRequest } from '@nexa/core';
import { resolveSelf, type FacultyFacts } from '@nexa/self';

/**
 * Resolves what the companion can truthfully say about itself.
 *
 * A thin adapter over `@nexa/self`, which does the actual work and is pure. The
 * only thing this class adds is the two facts that package deliberately refuses
 * to discover for itself: which faculties this deployment wired, and what time
 * it is.
 *
 * ## Why the faculties are passed in rather than detected
 *
 * A self model that inspected the running process would drift from the wiring
 * the moment either changed, and would have to know about `PortMap` — putting
 * knowledge of Core's internals inside a package that sits below it. The
 * composition root is the one component that already knows what it composed, so
 * it says so explicitly. The cost is that adding a faculty means editing one
 * list here; the benefit is that the list is reviewable, and a capability
 * claiming a faculty nobody wired is a compile error rather than a lie.
 */
export interface SelfModelDependencies {
  readonly clock: Clock;
  /**
   * Faculties this deployment actually composed.
   *
   * Read once at construction because composition does not change while the
   * process runs. A faculty that can come and go — a device, a body — is not a
   * faculty; it is reported per turn and resolved separately.
   */
  readonly composed: readonly FacultyKey[];
  /**
   * Faculties whose provider is currently failing.
   *
   * A function rather than a value so a later health check can be consulted per
   * turn without this signature changing. Today nothing reports unhealthy, and
   * returning an empty list is the honest answer rather than a placeholder.
   */
  readonly unhealthy?: () => readonly FacultyKey[];
  /**
   * Faculties the backend accepts a client as being able to supply.
   *
   * The trust boundary, stated by the composition root rather than inferred.
   * A faculty absent from this list cannot be satisfied by any device report,
   * however truthfully that device is described.
   */
  readonly clientProvidable?: readonly FacultyKey[];
  /**
   * Devices the client has reported. Empty until device reporting exists.
   *
   * A function for the same reason: devices are per-companion runtime state,
   * and the store that will hold them is not this one.
   */
  readonly devices?: (companionId: string) => readonly DeviceDescriptor[];
  readonly skills?: (companionId: string) => readonly SkillDescriptor[];
}

export class SelfModel implements SelfModelPort {
  readonly #clock: Clock;
  readonly #composed: readonly FacultyKey[];
  readonly #unhealthy: () => readonly FacultyKey[];
  readonly #clientProvidable: readonly FacultyKey[];
  readonly #devices: (companionId: string) => readonly DeviceDescriptor[];
  readonly #skills: (companionId: string) => readonly SkillDescriptor[];

  constructor(dependencies: SelfModelDependencies) {
    this.#clock = dependencies.clock;
    this.#composed = dependencies.composed;
    this.#unhealthy = dependencies.unhealthy ?? (() => []);
    this.#clientProvidable = dependencies.clientProvidable ?? [];
    this.#devices = dependencies.devices ?? (() => []);
    this.#skills = dependencies.skills ?? (() => []);
  }

  /**
   * Joins identity, faculties, the client's declaration and the body report.
   *
   * `async` because every port is, not because anything here waits. The
   * uniformity is what puts this under the same budgeting, cancellation and
   * recording as every other port, and it means an implementation that later
   * needs to read something is not a signature change.
   */
  async resolve(request: SelfModelRequest, _options: PortOptions): Promise<SelfState> {
    const facts: FacultyFacts = {
      composed: this.#composed,
      unhealthy: this.#unhealthy(),
      clientProvidable: this.#clientProvidable,
    };

    return resolveSelf({
      companionId: request.companionId,
      identity: request.identity,
      faculties: facts,
      client: request.clientCapabilities,
      body: request.body,
      devices: this.#devices(request.companionId),
      skills: this.#skills(request.companionId),
      at: timestamp(this.#clock.nowIso()),
    });
  }
}
