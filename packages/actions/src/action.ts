import type { ActionId, DecisionId } from '@nexa/shared';

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
 * exhaustively here and defensively there.
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
  readonly tone: 'neutral' | 'warm' | 'encouraging' | 'concerned' | 'playful';
}

/** Perform a bodily gesture. Presentation is entirely the client's. */
export interface GestureAction extends ActionBase<'gesture'> {
  readonly gesture: 'wave' | 'nod' | 'shrug' | 'think' | 'celebrate';
}

/** Direct attention. Coordinates are deliberately absent — see `target`. */
export interface LookAction extends ActionBase<'look'> {
  /**
   * Semantic target, never a coordinate. A backend that emitted world-space
   * positions would have to know the client's tracking frame, which is exactly
   * the coupling the client boundary exists to prevent.
   */
  readonly target: 'user' | 'away' | 'ahead';
}

/** Hold position and wait. The companion choosing not to fill a silence. */
export interface WaitAction extends ActionBase<'wait'> {
  readonly durationMs: number;
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
  readonly importance: number;
}

export type Action =
  | SpeakAction
  | GestureAction
  | LookAction
  | WaitAction
  | RememberAction;

export type ActionType = Action['type'];

/** Narrows the union to the single member matching `T`. */
export type ActionOfType<T extends ActionType> = Extract<Action, { type: T }>;

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
