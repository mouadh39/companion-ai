/**
 * The lifecycle of a conversation.
 *
 * `idle` exists as a distinct state from `ended` because an AR companion shares
 * a room with someone: a lull is not a goodbye. Collapsing the two would make
 * the companion either re-introduce itself after every pause or never conclude
 * anything. `idle` conversations are resumable with context intact; `ended`
 * ones are summarised and closed.
 */
export type ConversationState = 'active' | 'idle' | 'ended' | 'archived';

export const CONVERSATION_STATES = [
  'active',
  'idle',
  'ended',
  'archived',
] as const satisfies readonly ConversationState[];

/** States that still accept new messages. */
export const isOpenConversation = (state: ConversationState): boolean =>
  state === 'active' || state === 'idle';

/**
 * Who produced a message.
 *
 * `system` is deliberately present and deliberately not `assistant`: operator
 * instruction and companion speech must never be indistinguishable in stored
 * history, or a replayed conversation can promote injected text into something
 * the companion appears to have said.
 *
 * `tool` records a capability's result as its own turn, so the reasoning
 * behind a tool-informed answer is reconstructable from history alone.
 */
export type MessageRole = 'user' | 'companion' | 'system' | 'tool';

export const MESSAGE_ROLES = [
  'user',
  'companion',
  'system',
  'tool',
] as const satisfies readonly MessageRole[];

/**
 * How a conversation began.
 *
 * An autonomously initiated conversation is held to a different standard —
 * `11_Planning_Engine.md` allows the companion to speak first, and being able
 * to audit how often it does is what keeps that from becoming intrusive.
 */
export type ConversationTrigger = 'user_initiated' | 'companion_initiated' | 'scheduled' | 'resumed';

export const CONVERSATION_TRIGGERS = [
  'user_initiated',
  'companion_initiated',
  'scheduled',
  'resumed',
] as const satisfies readonly ConversationTrigger[];
