import type { ActionId, DecisionId, ToolId } from '@nexa/shared';
import type { ImportanceScore } from '../value-objects/score.js';
import type { Duration } from '../value-objects/timestamp.js';
import type { JsonObject } from '../types/json.js';
import type { MemberOfType } from '../types/utility.js';

/**
 * What a client is asked to do.
 *
 * This union is the *entire* contract between Nexa and every client — Unity,
 * Flutter, web, and whatever comes after. The companion never returns prose for
 * a client to interpret, and a client never asks the backend a question about
 * cognition. That constraint is what makes ADR-001 ("Unity is a client")
 * enforceable rather than a naming convention.
 *
 * Adding an action is therefore a protocol change: every client must be able to
 * ignore what it does not understand, which is why `type` is checked
 * exhaustively in `@nexa/actions` and defensively on each client.
 *
 * Defined here rather than in `@nexa/actions` because it is domain vocabulary,
 * and `@nexa/actions` — which validates it — sits above this layer. Validation
 * is behaviour; this is language. `@nexa/actions` re-exports these types so
 * existing importers are unaffected.
 */

interface ActionBase<TType extends string> {
  readonly id: ActionId;
  readonly type: TType;
  /** The decision this action realises. The audit link back to reasoning. */
  readonly decisionId: DecisionId;
}

/**
 * Say something.
 *
 * `text` is what the companion means; how it is delivered — rendered, spoken,
 * subtitled — is the client's decision, not the backend's.
 */
export interface SpeakAction extends ActionBase<'speak'> {
  readonly text: string;
  /** Delivery hint. A client free to ignore it must still render `text`. */
  readonly tone: SpeechTone;
}

export type SpeechTone = 'neutral' | 'warm' | 'encouraging' | 'concerned' | 'playful';

export const SPEECH_TONES = [
  'neutral',
  'warm',
  'encouraging',
  'concerned',
  'playful',
] as const satisfies readonly SpeechTone[];

/** Perform a bodily gesture. Presentation is entirely the client's. */
export interface GestureAction extends ActionBase<'gesture'> {
  readonly gesture: GestureKind;
}

export type GestureKind = 'wave' | 'nod' | 'shrug' | 'think' | 'celebrate';

export const GESTURE_KINDS = [
  'wave',
  'nod',
  'shrug',
  'think',
  'celebrate',
] as const satisfies readonly GestureKind[];

/** Direct attention. Coordinates are deliberately absent — see `target`. */
export interface LookAction extends ActionBase<'look'> {
  /**
   * Semantic target, never a coordinate. A backend that emitted world-space
   * positions would have to know the client's tracking frame, which is exactly
   * the coupling the client boundary exists to prevent.
   */
  readonly target: LookTarget;
}

export type LookTarget = 'user' | 'away' | 'ahead';

export const LOOK_TARGETS = ['user', 'away', 'ahead'] as const satisfies readonly LookTarget[];

/**
 * How the companion travels.
 *
 * `walk` is the default and the only mode every body is expected to have. A
 * client whose rig has no run cycle reports `skipped` rather than substituting
 * a walk, for the same reason an unknown gesture is reported rather than
 * replaced — a body that quietly downgrades what it was asked for is a body
 * deciding what the companion meant.
 */
export type MoveMode = 'walk' | 'run';

export const MOVE_MODES = ['walk', 'run'] as const satisfies readonly MoveMode[];

/**
 * Which way to travel, relative to the companion's own facing or to a target.
 *
 * `forward`/`backward`/`left`/`right` are egocentric — they mean what they mean
 * from where the companion is standing, which is the frame a person uses when
 * they say "go back two steps". `toward`/`away_from` are target-relative and
 * require `MoveAction.target` to be set; they express "move closer" and "move
 * away" without the backend having to know how far apart the two currently are.
 */
export type MoveDirection = 'forward' | 'backward' | 'left' | 'right' | 'toward' | 'away_from';

export const MOVE_DIRECTIONS = [
  'forward',
  'backward',
  'left',
  'right',
  'toward',
  'away_from',
] as const satisfies readonly MoveDirection[];

/**
 * How a distance was expressed.
 *
 * `steps` is carried rather than converted, because a step is a property of the
 * *body* and the backend does not know how long this one's legs are. Converting
 * "two steps" to metres here would bake one rig's stride into the protocol and
 * be wrong on every other body — including a robot. The client owns the
 * conversion, which is the same rule that keeps coordinates off the wire.
 */
export type DistanceUnit = 'steps' | 'metres';

export const DISTANCE_UNITS = ['steps', 'metres'] as const satisfies readonly DistanceUnit[];

/**
 * The roles a target may name, plus any name the client might recognise.
 *
 * The three roles are closed because they are about the *conversation* — the
 * person, not-the-person, and straight ahead — and every client can answer
 * them. Anything else is a name, and the backend deliberately cannot enumerate
 * those: which names resolve is a fact about the room the client is in, not
 * about the companion.
 *
 * `string & {}` keeps the three roles in autocomplete while admitting a name.
 * A name the client cannot locate comes back as a `skipped` outcome naming the
 * target, which is how the companion finds out — see `ActionOutcome`. That
 * feedback is what makes an open vocabulary safe rather than a guess.
 */
export type MoveTargetRole = 'user' | 'away' | 'ahead';

export const MOVE_TARGET_ROLES = [
  'user',
  'away',
  'ahead',
] as const satisfies readonly MoveTargetRole[];

export type MoveTarget = MoveTargetRole | (string & {});

/**
 * Travel somewhere.
 *
 * Semantic throughout: a destination is named, never measured, and a distance
 * carries the unit it was said in. A backend that emitted coordinates would
 * have to know the client's tracking frame, floor height and units, which is
 * precisely the coupling the client boundary exists to prevent — the same
 * companion would be wrong on a phone, on glasses and in a robot.
 *
 * `target` and `direction` are independently optional because the three things
 * a person actually asks for are differently shaped:
 *
 * - *"come here"* — a target, no direction, no distance.
 * - *"go back two steps"* — a direction and a distance, no target.
 * - *"move closer"* — a target and `toward`, with distance left to the client.
 *
 * At least one of the two must be present; `validateAction` enforces it. An
 * action carrying neither names no destination at all, and a body asked to move
 * nowhere in particular would have to invent one.
 */
export interface MoveAction extends ActionBase<'move'> {
  /** Where to go, or null when the movement is purely directional. */
  readonly target: MoveTarget | null;
  /** Which way, or null when the target alone says where to go. */
  readonly direction: MoveDirection | null;
  /**
   * How far, in `distanceUnit`. Null means "as far as it takes" for a target,
   * and "one comfortable step" for a bare direction — the client decides, since
   * only it knows the geometry.
   */
  readonly distance: number | null;
  /** The unit `distance` was expressed in. Null exactly when `distance` is. */
  readonly distanceUnit: DistanceUnit | null;
  readonly mode: MoveMode;
}

/**
 * Keep travelling with a target until told to stop.
 *
 * A *latched behaviour*, not a long movement, and that distinction is the whole
 * reason it is its own action. A `move` completes when the companion arrives; a
 * `follow` completes the moment following becomes **active**, and then persists
 * with no further instruction until a `stop` cancels it.
 *
 * The tracking itself is entirely the client's. The backend says who to follow
 * and stops caring — it must never be the thing issuing a destination per frame,
 * because a body whose every step costs a network round trip is a body that
 * cannot keep up with a walking person, on any transport.
 */
export interface FollowAction extends ActionBase<'follow'> {
  readonly target: MoveTarget;
  /**
   * How closely to trail, in metres. Null lets the client choose a distance
   * that suits its own scale — a room-scale companion and a desk-scale one do
   * not agree on "close".
   */
  readonly distance: number | null;
  readonly mode: MoveMode;
}

/**
 * What a stop puts an end to.
 *
 * Separated because "stop" and "stop following me" are different requests, and
 * collapsing them loses the one the user is more likely to mean. Stopping the
 * current walk should not silently cancel a standing instruction to follow, and
 * cancelling a follow should not require the companion to also be walking.
 */
export type StopScope = 'movement' | 'follow' | 'all';

export const STOP_SCOPES = [
  'movement',
  'follow',
  'all',
] as const satisfies readonly StopScope[];

/**
 * Cease a physical behaviour.
 *
 * A first-class action rather than an absence of one. "Stop" is something the
 * companion *does*, it has an outcome like anything else, and it must be
 * expressible while nothing else is being generated — which a flag on another
 * action could not be.
 */
export interface StopAction extends ActionBase<'stop'> {
  readonly scope: StopScope;
}

/** Hold position and wait. The companion choosing not to fill a silence. */
export interface WaitAction extends ActionBase<'wait'> {
  readonly duration: Duration;
}

/**
 * Commit something to long-term memory.
 *
 * Emitted so the *decision* to remember is visible in the action stream and in
 * the audit trail. The write itself happens asynchronously in the worker; a
 * client that receives this may surface it ("I'll remember that") and must not
 * treat it as a storage operation of its own.
 */
export interface RememberAction extends ActionBase<'remember'> {
  readonly content: string;
  readonly importance: ImportanceScore;
}

/**
 * Invoke a capability.
 *
 * Arguments are `JsonObject` rather than a per-tool type because the set of
 * tools is open — `03_Companion_Core.md` requires new tools to be addable
 * without changing the core. Shape validation belongs to the tool's own
 * `parameters` schema, checked at the registry, not to this union.
 */
export interface CallToolAction extends ActionBase<'call_tool'> {
  readonly toolId: ToolId;
  readonly arguments: JsonObject;
}

export type Action =
  | SpeakAction
  | GestureAction
  | LookAction
  | WaitAction
  | RememberAction
  | CallToolAction
  | MoveAction
  | FollowAction
  | StopAction;

export type ActionType = Action['type'];

export const ACTION_TYPES = [
  'speak',
  'gesture',
  'look',
  'wait',
  'remember',
  'call_tool',
  'move',
  'follow',
  'stop',
] as const satisfies readonly ActionType[];

/**
 * The action types that move or pose a body.
 *
 * Named as a set because three different places need the same answer and had
 * begun to each hold their own list: generation decides whether to describe a
 * body to the model, the self model decides whether to claim one, and the
 * outcome channel decides which actions are worth waiting on a report from.
 * Three copies of this list is three chances to add an action to two of them.
 */
export const EMBODIED_ACTION_TYPES = [
  'gesture',
  'look',
  'move',
  'follow',
  'stop',
] as const satisfies readonly ActionType[];

export type EmbodiedActionType = (typeof EMBODIED_ACTION_TYPES)[number];

export const isEmbodiedAction = (type: ActionType): type is EmbodiedActionType =>
  (EMBODIED_ACTION_TYPES as readonly ActionType[]).includes(type);

/** Narrows the union to the single member matching `TType`. */
export type ActionOfType<TType extends ActionType> = MemberOfType<Action, TType>;

/**
 * Caps how many actions one turn may produce.
 *
 * A companion that emits fifteen actions for one message is not expressive, it
 * is malfunctioning — and on a client each action costs an animation slot or a
 * speech queue entry.
 */
export const MAX_ACTIONS_PER_TURN = 8;

/** Hard ceiling on spoken text, in characters. Long speech is a bug, not a feature. */
export const MAX_SPEAK_LENGTH = 4_000;

/**
 * Why a generated action was refused.
 *
 * Here rather than in `@nexa/actions` for the same reason the action types
 * themselves are: this is domain vocabulary, not behaviour. The validator that
 * produces these lives one layer up, but the turn record that persists them
 * lives in this package, and a persisted value cannot depend on the code that
 * happened to create it.
 *
 * The four are separated because they route differently. `schema` is a
 * generation bug, `safety` and `permission` are policy outcomes worth alerting
 * on, and `budget` is a capacity signal.
 */
export type RejectionReason = 'schema' | 'safety' | 'permission' | 'budget';

export const REJECTION_REASONS = [
  'schema',
  'safety',
  'permission',
  'budget',
] as const satisfies readonly RejectionReason[];
