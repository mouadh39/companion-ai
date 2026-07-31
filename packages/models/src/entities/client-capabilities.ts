import type { ActionType } from './action.js';

/**
 * What the client on the other end can actually do.
 *
 * This is the field that makes "AR glasses, robotics, and voice-only clients
 * without redesigning Core" true rather than aspirational. Core emits *semantic*
 * actions — speak, gesture, look — and something has to know that a headless
 * voice client cannot realise a gesture. Without this, that action is generated,
 * shipped, and silently dropped on the far side, which is indistinguishable
 * from a companion that never gestures.
 *
 * Declared by the client rather than inferred from a platform string, because
 * the same platform ships in configurations that differ: a phone with the
 * screen off is a voice-only client.
 */
export interface ClientCapabilities {
  /**
   * Action types this client can execute.
   *
   * A closed list rather than a set of feature flags, so adding a robotics
   * action (`move_to`, `grasp`) extends one union and every client that cannot
   * do it is correct by default rather than by remembering to opt out.
   */
  readonly actions: readonly ActionType[];
  /** Whether the client can consume a token stream rather than a final answer. */
  readonly streaming: boolean;
  /** BCP-47 tag, or null when the client has no preference. */
  readonly locale: string | null;
}

/**
 * What a client that says nothing is assumed to support.
 *
 * Everything. Absence of a declaration is not evidence of incapability, and
 * filtering on a guess would break every client that has not been updated to
 * declare itself. Filtering only happens when a client has actually said what
 * it can do.
 */
export const UNRESTRICTED_CLIENT: ClientCapabilities = {
  actions: ['speak', 'gesture', 'look', 'wait', 'remember', 'call_tool'],
  streaming: false,
  locale: null,
};

/** A voice-only client: speech and memory, no embodiment. */
export const VOICE_ONLY_CLIENT: ClientCapabilities = {
  actions: ['speak', 'wait', 'remember', 'call_tool'],
  streaming: true,
  locale: null,
};

export const canRender = (
  capabilities: ClientCapabilities,
  action: ActionType,
): boolean => capabilities.actions.includes(action);
