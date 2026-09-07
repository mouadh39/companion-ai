import type { ActionId, TurnId } from '@nexa/shared';
import type { ActionType } from './action.js';
import type { Timestamp } from '../value-objects/timestamp.js';

/**
 * What actually happened when a client tried to perform an action.
 *
 * The other half of the action protocol, and the half that was missing. The
 * backend generates actions and ships them; ADR-001 makes the client the thing
 * that owns a body, so **the backend genuinely does not know whether an action
 * ran until it is told**. `nexa.action.executed` has said exactly that in the
 * event catalogue since Milestone 1; this is the value that carries it.
 *
 * Without this type the companion's only source of truth about its own body is
 * the language model that asked for the movement — which is to say, a system
 * with no access to the body at all. That is the specific failure the whole
 * design exists to prevent: a companion that says "done" because saying "done"
 * is what usually follows being asked.
 */

/**
 * How an action ended.
 *
 * Five outcomes rather than a boolean, mirroring the client's own vocabulary
 * exactly. They are not degrees of the same thing and they do not mean the same
 * thing to the companion: `skipped` is a body that *cannot*, `failed` is a body
 * that tried and could not, `cancelled` is a decision to stop, and `timed_out`
 * is a body that never reported back. Collapsing them makes a missing gesture
 * indistinguishable from a broken one, and leaves the companion unable to say
 * which of the two it should apologise for.
 */
export type ActionOutcomeStatus =
  | 'completed'
  | 'failed'
  | 'skipped'
  | 'cancelled'
  | 'timed_out';

export const ACTION_OUTCOME_STATUSES = [
  'completed',
  'failed',
  'skipped',
  'cancelled',
  'timed_out',
] as const satisfies readonly ActionOutcomeStatus[];

/**
 * Why an action did not complete, in terms the companion can reason about.
 *
 * A closed vocabulary rather than the client's free-text message, because this
 * is the field anything downstream is allowed to branch on. The prose in
 * `detail` is for a log and for the model to paraphrase; a rule that keyed on
 * it would be a rule keyed on another team's error strings.
 *
 * The distinction that matters most here is `unreachable` versus `blocked`.
 * "There is no path to you at all" and "something got in the way" call for
 * different things to be said and different things to be learned, and a
 * companion given only "movement failed" can say neither.
 */
export type ActionFailureReason =
  /** A path existed but something obstructed it. Usually retryable. */
  | 'blocked'
  /** No path to the destination exists from here. Usually not retryable. */
  | 'unreachable'
  /** The client does not know what the named target refers to. */
  | 'unresolved_target'
  /** This body has no way to perform this action — no run cycle, no such gesture. */
  | 'unsupported'
  /** Superseded by a later instruction, or stopped by the user. */
  | 'interrupted'
  /** A subsystem the action depended on failed — a speech provider, a rig. */
  | 'subsystem_error'
  /** The client reported a failure it could not classify. */
  | 'unknown';

export const ACTION_FAILURE_REASONS = [
  'blocked',
  'unreachable',
  'unresolved_target',
  'unsupported',
  'interrupted',
  'subsystem_error',
  'unknown',
] as const satisfies readonly ActionFailureReason[];

/**
 * One action, and what became of it.
 *
 * `turnId` is carried so an outcome can be traced back to the reasoning that
 * produced the action, which is what will eventually let the companion learn
 * that a *kind* of request tends to fail — not merely that one did.
 *
 * `reason` is null exactly when `status` is `completed`. A completed action has
 * nothing to explain, and permitting a reason alongside success would invite
 * one to be set and then read.
 */
export interface ActionOutcome {
  readonly actionId: ActionId;
  readonly actionType: ActionType;
  /**
   * Which specific variant of the action this was — the gesture that was
   * played, the target that was walked to.
   *
   * Nullable, and null on a client that does not send it, so this is additive
   * to every outcome already in flight.
   *
   * It exists because the type alone loses the thing the person actually asked
   * about. Told only that "a gesture finished", a companion asked *"did that
   * wave work?"* has no way to connect the two, and was observed answering
   * "I haven't waved yet" while holding the successful outcome. It also
   * matters later: "waving keeps failing" and "gesturing keeps failing" are
   * different lessons, and only one of them is learnable from `actionType`.
   */
  readonly parameter: string | null;
  /** The turn that generated the action, when the client echoed it back. */
  readonly turnId: TurnId | null;
  readonly status: ActionOutcomeStatus;
  /** Null exactly when `status` is `completed`. */
  readonly reason: ActionFailureReason | null;
  /** The client's own words. For logs and for the model to paraphrase, never to branch on. */
  readonly detail: string | null;
  /** When the client finished with it. The client's clock, not the backend's. */
  readonly at: Timestamp;
  /** How long the body spent on it. */
  readonly durationMs: number;
}

/** True when the body did what it was asked. */
export const succeeded = (outcome: ActionOutcome): boolean =>
  outcome.status === 'completed';

/**
 * True when the companion should treat this as worth mentioning unprompted.
 *
 * `cancelled` is excluded deliberately. The companion cancelled it — usually
 * because the user interrupted — so reporting it back reads as complaining
 * about being interrupted rather than as honesty.
 */
export const worthReporting = (outcome: ActionOutcome): boolean =>
  outcome.status === 'failed' ||
  outcome.status === 'skipped' ||
  outcome.status === 'timed_out';

/**
 * The coarse thing a body is doing.
 *
 * `unknown` is a real answer and not a placeholder. A client that has connected
 * but never reported is genuinely in this state, and the companion saying it is
 * not sure what it is doing is the correct behaviour — far better than the
 * alternative, which is assuming `idle` and asserting a stillness it has not
 * verified.
 */
export type BodyActivity =
  | 'idle'
  | 'walking'
  | 'following'
  | 'gesturing'
  | 'looking'
  | 'speaking'
  | 'unknown';

export const BODY_ACTIVITIES = [
  'idle',
  'walking',
  'following',
  'gesturing',
  'looking',
  'speaking',
  'unknown',
] as const satisfies readonly BodyActivity[];

/**
 * What the companion's body is doing, as the client last reported it.
 *
 * The *authoritative* answer, and the reason this is a value rather than
 * something the backend infers: the backend cannot know that a walk is still in
 * progress, that a follow is latched, or that the agent fell off its NavMesh.
 * Every field here is owned by the client and is only ever copied.
 *
 * Deliberately coarse. This is not a pose, a transform or a velocity — none of
 * which belong on a network at all — it is the handful of facts the companion
 * needs in order to speak truthfully about itself. Frame-rate state stays where
 * it is produced.
 */
export interface BodyState {
  readonly activity: BodyActivity;
  /** What is being followed right now, or null when nothing is. */
  readonly following: string | null;
  /**
   * Action types this body can actually perform, as the client declares them.
   *
   * The runtime half of the capability model. `ClientCapabilities.actions` says
   * what the client can *receive*; this says what it can presently *do*, which
   * differs the moment a rig is missing a clip or an agent is off its NavMesh.
   */
  readonly canPerform: readonly ActionType[];
  /** Most recent first, bounded by the store. The companion's short-term body memory. */
  readonly recentOutcomes: readonly ActionOutcome[];
  /** When the client last said anything about itself. */
  readonly observedAt: Timestamp;
  /**
   * True when nothing has been reported recently enough to rely on.
   *
   * Carried rather than computed downstream, for the same reason
   * `WorldSnapshot.stale` is: `deliberate()` never reads a clock, so a staleness
   * check performed during reasoning would be a time dependency smuggled into a
   * pure function. The capability owns the threshold and states the conclusion.
   */
  readonly stale: boolean;
}

/**
 * How long a body report stays trustworthy, in ms.
 *
 * Ninety seconds. Long enough to survive a pause in the conversation — the body
 * reports on action boundaries, not on a timer, so a companion standing still
 * and being talked to legitimately sends nothing. Short enough that a client
 * which has crashed or disconnected stops being described in the present tense.
 */
export const BODY_STATE_FRESHNESS_MS = 90 * 1000;

/** How many outcomes the companion carries into a turn. */
export const MAX_RECENT_OUTCOMES = 5;

/**
 * What to assume about a body nothing has reported on.
 *
 * Every field is deliberately the *uninformative* answer rather than the
 * optimistic one. `unknown` activity, nothing followed, nothing known to be
 * performable, and `stale: true` — so a companion composed with an embodiment
 * capability that has never heard from a client describes itself as not knowing,
 * which is true, instead of as idle and capable, which is a guess.
 */
export const unknownBodyState = (at: Timestamp): BodyState => ({
  activity: 'unknown',
  following: null,
  canPerform: [],
  recentOutcomes: [],
  observedAt: at,
  stale: true,
});
