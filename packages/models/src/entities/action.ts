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
  | CallToolAction;

export type ActionType = Action['type'];

export const ACTION_TYPES = [
  'speak',
  'gesture',
  'look',
  'wait',
  'remember',
  'call_tool',
] as const satisfies readonly ActionType[];

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
