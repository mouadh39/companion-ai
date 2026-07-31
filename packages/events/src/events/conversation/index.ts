import type {
  ConversationId,
  ConversationState,
  ConversationTrigger,
  MemoryId,
  MessageId,
} from '@nexa/models';
import type { EventEnvelope } from '../../interfaces/envelope.js';
import { defineEvent } from '../../interfaces/envelope.js';

/**
 * Facts about dialogue.
 *
 * `nexa.conversation.message.created` is the companion speaking. The brief
 * called it `AssistantMessageCreated`; the domain says *companion* everywhere
 * (`MessageRole = 'user' | 'companion' | 'system' | 'tool'`), and "assistant"
 * appears only in provider-facing `ModelMessage`. Two words for one concept in
 * one codebase is how a rename gets half-done a year later.
 *
 * Message events carry ids and lengths, never message text. Transcripts are
 * loaded through a port when a consumer genuinely needs them — putting content
 * on the bus would mean every listener, every log row and every replay carries
 * the full conversation.
 */

export interface MessageReceivedPayload {
  readonly messageId: MessageId;
  readonly conversationId: ConversationId;
  /** Characters, not tokens. Tokenisation is the provider's business. */
  readonly length: number;
}

export interface MessageCreatedPayload {
  readonly messageId: MessageId;
  readonly conversationId: ConversationId;
  readonly length: number;
  /** Whether the companion spoke without being addressed first. */
  readonly proactive: boolean;
}

export interface ConversationStartedPayload {
  readonly conversationId: ConversationId;
  readonly trigger: ConversationTrigger;
}

export interface ConversationEndedPayload {
  readonly conversationId: ConversationId;
  readonly messageCount: number;
  readonly durationMs: number;
  /** How it ended — `ended` on purpose, `archived` after prolonged idleness. */
  readonly finalState: Extract<ConversationState, 'ended' | 'archived'>;
}

export interface ConversationSummarizedPayload {
  readonly conversationId: ConversationId;
  readonly topics: readonly string[];
  /** Memories the summary produced. Links transcript to long-term knowledge. */
  readonly producedMemories: readonly MemoryId[];
}

export const userMessageReceived = defineEvent<
  'nexa.conversation.message.received',
  MessageReceivedPayload
>('nexa.conversation.message.received', 1, { source: 'conversation' });

export const companionMessageCreated = defineEvent<
  'nexa.conversation.message.created',
  MessageCreatedPayload
>('nexa.conversation.message.created', 1, { source: 'conversation' });

export const conversationStarted = defineEvent<
  'nexa.conversation.started',
  ConversationStartedPayload
>('nexa.conversation.started', 1, { source: 'conversation' });

export const conversationEnded = defineEvent<
  'nexa.conversation.ended',
  ConversationEndedPayload
>('nexa.conversation.ended', 1, { source: 'conversation' });

export const conversationSummarized = defineEvent<
  'nexa.conversation.summarized',
  ConversationSummarizedPayload
>('nexa.conversation.summarized', 1, { source: 'conversation' });

export type ConversationEvent =
  | EventEnvelope<'nexa.conversation.message.received', MessageReceivedPayload>
  | EventEnvelope<'nexa.conversation.message.created', MessageCreatedPayload>
  | EventEnvelope<'nexa.conversation.started', ConversationStartedPayload>
  | EventEnvelope<'nexa.conversation.ended', ConversationEndedPayload>
  | EventEnvelope<'nexa.conversation.summarized', ConversationSummarizedPayload>;

export const CONVERSATION_EVENTS = [
  userMessageReceived,
  companionMessageCreated,
  conversationStarted,
  conversationEnded,
  conversationSummarized,
] as const;
