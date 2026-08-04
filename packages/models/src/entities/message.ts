import type { ConversationId, MessageId, ToolId, TurnId } from '@nexa/shared';
import type { MessageRole } from '../enums/conversation.js';
import type { ToolInvocationStatus } from '../enums/tool.js';
import type { Timestamp } from '../value-objects/timestamp.js';
import type { Metadata } from '../value-objects/metadata.js';

/**
 * One entry in a conversation's transcript.
 *
 * A discriminated union on `role` rather than one interface with optional
 * fields. The alternative — a single shape where `toolId` is present only
 * sometimes — makes every consumer write a null check the compiler cannot
 * verify, and makes it possible to construct a user message that carries a tool
 * result. Here that combination does not typecheck.
 */

interface MessageBase<TRole extends MessageRole> {
  readonly id: MessageId;
  readonly conversationId: ConversationId;
  readonly role: TRole;
  readonly content: string;
  readonly at: Timestamp;
  /**
   * The turn that produced this message, or null for messages that predate the
   * turn pipeline. The audit link from transcript back to reasoning.
   */
  readonly turnId: TurnId | null;
  /**
   * Token count, or null when not yet measured.
   *
   * Stored rather than recomputed: it is needed to trim working memory on every
   * turn, and re-tokenising the whole history each time is the kind of cost
   * that is invisible at ten messages and dominant at ten thousand.
   */
  readonly tokens: number | null;
  readonly metadata: Metadata;
}

/** Something the user said or typed. */
export interface UserMessage extends MessageBase<'user'> {
  readonly role: 'user';
}

/** Something the companion said. */
export interface CompanionMessage extends MessageBase<'companion'> {
  readonly role: 'companion';
}

/**
 * Operator-supplied instruction.
 *
 * Kept as its own role so that instruction and companion speech are never
 * confusable in stored history. A replay that promoted a system message into
 * the companion's voice would let injected text become something the companion
 * appears to have committed to.
 */
export interface SystemMessage extends MessageBase<'system'> {
  readonly role: 'system';
}

/** The result of a capability invocation, recorded as its own turn. */
export interface ToolMessage extends MessageBase<'tool'> {
  readonly role: 'tool';
  readonly toolId: ToolId;
  readonly status: ToolInvocationStatus;
}

export type Message = UserMessage | CompanionMessage | SystemMessage | ToolMessage;

/** Narrows the union to the single member matching `TRole`. */
export type MessageOfRole<TRole extends MessageRole> = Extract<Message, { readonly role: TRole }>;

/**
 * Hard ceiling on a single message, in characters.
 *
 * Bounds the worst case for storage, tokenisation and prompt assembly in one
 * place. Without it a pasted logfile becomes an unbounded cost on a path that
 * runs for every turn.
 */
export const MAX_MESSAGE_LENGTH = 32_000;

/** True when the message should be rendered in a transcript shown to the user. */
export const isVisibleToUser = (message: Message): boolean =>
  message.role === 'user' || message.role === 'companion';
