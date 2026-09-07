import type { Clock, CompanionId } from '@nexa/shared';
import type {
  ActionOutcome,
  ActionType,
  BodyActivity,
  BodyState,
  DeviceDescriptor,
  SkillDescriptor,
} from '@nexa/models';
import {
  BODY_STATE_FRESHNESS_MS,
  MAX_RECENT_OUTCOMES,
  timestamp,
  unknownBodyState,
} from '@nexa/models';
import type { ActionOutcomePort, EmbodimentPort, PortOptions } from '@nexa/core';

/**
 * What the companion's body has told us about itself.
 *
 * Implements both halves of the embodiment loop against one store, which is the
 * whole reason `EmbodimentPort` and `ActionOutcomePort` are declared beside each
 * other in Core. Split across two capabilities they would eventually be bound to
 * two different stores, and an outcome would be recorded somewhere the next turn
 * does not read — a failure that looks exactly like a companion that never
 * learns what its body did.
 *
 * ## Why this is in-memory
 *
 * Body state is *ephemeral by nature*, not by expedience. "I am walking" is
 * false the moment the process restarts, because the client restarted too and
 * nothing is walking. Persisting it would let the companion resume a turn
 * claiming to be mid-stride across a restart, which is worse than admitting it
 * does not know: `unknownBodyState` is the honest answer to a body that has not
 * reported, and after a restart no body has.
 *
 * What *is* worth keeping — that a movement to the kitchen failed as blocked
 * three times this week — is a memory and a reflection, not body state, and it
 * travels the path everything durable already travels: an event on the bus.
 *
 * ## Scoping
 *
 * Keyed on `companionId` alone, deliberately, unlike memory. A body is not the
 * user's; one companion has one body at a time, and two people talking to the
 * same embodied companion are looking at the same character. Keying on the user
 * would give each of them a private, contradictory belief about where a single
 * physical thing is standing.
 */

interface BodyRecord {
  /** What the client says is plugged into it. Evidence, never permission. */
  devices: readonly DeviceDescriptor[];
  /** What the body says it knows how to perform. */
  skills: readonly SkillDescriptor[];
  activity: BodyActivity;
  following: string | null;
  canPerform: readonly ActionType[];
  /** Most recent first. Bounded on write; see `MAX_RECENT_OUTCOMES`. */
  outcomes: ActionOutcome[];
  observedAtMs: number;
}

export interface EmbodimentStateDependencies {
  readonly clock: Clock;
  /**
   * How long a report stays trustworthy. Overridable so a test can age a body
   * without waiting, and so a deployment on a flaky link can widen it.
   */
  readonly freshnessMs?: number;
}

export class EmbodimentState implements EmbodimentPort, ActionOutcomePort {
  readonly #clock: Clock;
  readonly #freshnessMs: number;
  readonly #bodies = new Map<string, BodyRecord>();

  constructor(dependencies: EmbodimentStateDependencies) {
    this.#clock = dependencies.clock;
    this.#freshnessMs = dependencies.freshnessMs ?? BODY_STATE_FRESHNESS_MS;
  }

  /**
   * The body as last reported, with staleness already decided.
   *
   * `stale` is computed here rather than downstream because `deliberate()` and
   * the prompt builder must never read a clock — a staleness check performed
   * during reasoning is a time dependency smuggled into a pure function. The
   * capability owns the threshold and states the conclusion, exactly as the
   * world model does.
   */
  async state(companionId: CompanionId, _options: PortOptions): Promise<BodyState> {
    const now = this.#clock.now();
    const record = this.#bodies.get(companionId);

    if (record === undefined) return unknownBodyState(timestamp(this.#clock.nowIso()));

    const stale = now - record.observedAtMs > this.#freshnessMs;

    return {
      // A stale body is not merely an old reading, it is an *unknown* one. The
      // last thing it said it was doing stopped being evidence when the report
      // stopped arriving, and carrying it forward is how a companion comes to
      // claim it is still walking towards someone who left.
      activity: stale ? 'unknown' : record.activity,
      following: stale ? null : record.following,
      canPerform: stale ? [] : record.canPerform,
      // Outcomes survive staleness. They are statements about things that
      // already finished, and remain true however long ago they were reported —
      // unlike an activity, which is a claim about the present.
      recentOutcomes: record.outcomes.slice(0, MAX_RECENT_OUTCOMES),
      observedAt: timestamp(new Date(record.observedAtMs).toISOString()),
      stale,
    };
  }

  /**
   * Records what the client said happened.
   *
   * The activity is *inferred* from the outcome rather than taken from a
   * separate field, because an outcome is the only moment the client is
   * guaranteed to speak. A body that reported activity independently would need
   * to poll, and a body that never polled would drift.
   */
  async report(
    companionId: CompanionId,
    outcome: ActionOutcome,
    _options: PortOptions,
  ): Promise<void> {
    const record = this.#bodies.get(companionId) ?? {
      activity: 'idle' as BodyActivity,
      following: null,
      canPerform: [] as readonly ActionType[],
      devices: [] as readonly DeviceDescriptor[],
      skills: [] as readonly SkillDescriptor[],
      outcomes: [],
      observedAtMs: this.#clock.now(),
    };

    record.outcomes = [outcome, ...record.outcomes].slice(0, MAX_RECENT_OUTCOMES);
    record.observedAtMs = this.#clock.now();

    // A follow that completed means following is now *active* — the action
    // completes when the behaviour latches, not when it ends. Everything else
    // that completes leaves the body idle, because the executor performs one
    // action at a time and has nothing else in hand.
    if (outcome.actionType === 'follow' && outcome.status === 'completed') {
      record.activity = 'following';
    } else if (outcome.actionType === 'stop') {
      record.activity = 'idle';
      record.following = null;
    } else if (record.activity !== 'following') {
      record.activity = 'idle';
    }

    this.#bodies.set(companionId, record);
  }

  /**
   * Records what the body says it is doing and can do, independent of any one
   * action.
   *
   * Separate from `report` because the two answer different questions and
   * arrive at different times. An outcome is history; this is the present, and
   * a client sends it when the present changes — starting a walk, losing its
   * NavMesh, latching a follow — rather than on a timer.
   */
  observe(
    companionId: CompanionId,
    observation: {
      readonly activity: BodyActivity;
      readonly following: string | null;
      readonly canPerform: readonly ActionType[];
      readonly devices?: readonly DeviceDescriptor[];
      readonly skills?: readonly SkillDescriptor[];
    },
  ): void {
    const record = this.#bodies.get(companionId);

    this.#bodies.set(companionId, {
      activity: observation.activity,
      following: observation.following,
      canPerform: observation.canPerform,
      // Replaced wholesale rather than merged when reported. A client's device
      // list is a complete statement about its environment, so a device it has
      // stopped listing has *gone* — merging would leave an unplugged
      // microphone in the model forever. Omitted entirely means "not saying",
      // which keeps what was last known.
      devices: observation.devices ?? record?.devices ?? [],
      skills: observation.skills ?? record?.skills ?? [],
      outcomes: record?.outcomes ?? [],
      observedAtMs: this.#clock.now(),
    });
  }

  /** What the client last said is connected. Empty when it has never said. */
  devicesOf(companionId: CompanionId): readonly DeviceDescriptor[] {
    return this.#bodies.get(companionId)?.devices ?? [];
  }

  /** What the body last said it knows how to perform. */
  skillsOf(companionId: CompanionId): readonly SkillDescriptor[] {
    return this.#bodies.get(companionId)?.skills ?? [];
  }

  /** Exposed for tests and the replay harness. Nothing on the request path reads it. */
  snapshot(companionId: CompanionId): BodyState | null {
    const record = this.#bodies.get(companionId);
    if (record === undefined) return null;

    return {
      activity: record.activity,
      following: record.following,
      canPerform: record.canPerform,
      recentOutcomes: record.outcomes,
      observedAt: timestamp(new Date(record.observedAtMs).toISOString()),
      stale: false,
    };
  }
}
