import type { CompanionId, ConversationId, MemoryId, UserId } from '@nexa/shared';
import type { ConversationState, ConversationTrigger } from '../enums/conversation.js';
import type { Timestamp } from '../value-objects/timestamp.js';
import type { Metadata } from '../value-objects/metadata.js';

/**
 * A bounded stretch of dialogue.
 *
 * Holds no messages. `messageCount` is a counter and the messages themselves
 * are fetched by `conversationId` when needed, because a conversation that
 * embedded its transcript could not be listed, counted or summarised without
 * loading every word of it. The docs' `Conversation → Messages` relationship is
 * real; it is expressed as a key on `Message`, pointing here.
 */
export interface Conversation {
  readonly id: ConversationId;
  readonly userId: UserId;
  readonly companionId: CompanionId;
  readonly state: ConversationState;
  readonly trigger: ConversationTrigger;
  readonly startedAt: Timestamp;
  /** Null while the conversation is still open. */
  readonly endedAt: Timestamp | null;
  /** Last activity. Drives the transition to `idle` and ordering in a list. */
  readonly lastMessageAt: Timestamp;
  /** Maintained incrementally. Counting rows to render a list does not scale. */
  readonly messageCount: number;
  readonly summary: ConversationSummary | null;
  readonly metadata: Metadata;
}

/**
 * A conversation compressed to what is worth carrying forward.
 *
 * The mechanism that makes long relationships affordable. Working memory is
 * bounded, so a three-hour conversation cannot be replayed into the next one;
 * what survives is this. Produced by the worker after a conversation ends, and
 * null until then — a conversation is not summarised while it is still moving.
 */
export interface ConversationSummary {
  /** A few sentences, in the companion's voice. Enters the prompt directly. */
  readonly text: string;
  /** Topics covered, for retrieval and for "what did we talk about last week?". */
  readonly topics: readonly string[];
  /**
   * Memories this conversation produced.
   *
   * The link from transcript to long-term knowledge. Without it, a memory's
   * provenance ends at "a conversation", and the user cannot be shown the
   * exchange that produced something the companion believes about them.
   */
  readonly producedMemories: readonly MemoryId[];
  readonly generatedAt: Timestamp;
}

/**
 * How long a conversation may sit quiet before it is considered idle.
 *
 * Ten minutes because an AR companion shares a room: a pause while the user
 * concentrates is not the end of the exchange, and re-greeting someone who
 * never left is worse than staying quiet.
 */
export const IDLE_AFTER_MS = 10 * 60 * 1000;

/**
 * How long an idle conversation may sit before it ends and is summarised.
 *
 * Six hours — long enough to survive a working day's interruptions, short
 * enough that "yesterday" is never the same conversation as "today".
 */
export const END_AFTER_IDLE_MS = 6 * 60 * 60 * 1000;
