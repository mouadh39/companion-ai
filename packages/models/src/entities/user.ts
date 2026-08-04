import type { CompanionId, UserId } from '@nexa/shared';
import type { CommunicationStyle } from '../enums/relationship.js';
import type { Timestamp } from '../value-objects/timestamp.js';
import type { Metadata } from '../value-objects/metadata.js';

/**
 * The person the companion belongs to.
 *
 * Small on purpose. `User` is the aggregate *root* — conversations, memories,
 * goals, relationships and voice sessions all reference it — but it does not
 * contain any of them. Embedding collections here would mean loading a user
 * implies loading years of history, and the one query every request performs
 * would become the most expensive one in the system.
 *
 * So the relationships in `docs/` are expressed as foreign keys pointing *at*
 * this type, never as arrays hanging off it. That is what lets the model scale
 * to millions of users: the root stays constant-size regardless of how much the
 * user has done.
 */
export interface User {
  readonly id: UserId;
  /** What the companion calls them. Not a legal name and never used as a key. */
  readonly displayName: string;
  /** BCP 47, e.g. `en-GB`. Drives language, not formatting alone. */
  readonly locale: string;
  /**
   * IANA zone, e.g. `Africa/Tunis`.
   *
   * Stored per user rather than derived per request because the planning engine
   * schedules against it. "Remind me tomorrow morning" resolved in the server's
   * zone is wrong for everyone not sitting in that datacentre.
   */
  readonly timezone: string;
  readonly createdAt: Timestamp;
  readonly preferences: UserPreferences;
  readonly metadata: Metadata;
}

/**
 * Settings the user controls directly.
 *
 * Distinct from anything the companion *infers* — inferred communication
 * preferences live on `Relationship`, because those are beliefs that can be
 * wrong. What is stated here is not a belief, and the companion must not
 * quietly override it with something it thinks it learned.
 */
export interface UserPreferences {
  /** Explicitly chosen. The relationship's learned style never overrides this. */
  readonly communicationStyle: CommunicationStyle | null;
  /**
   * Whether the companion may speak without being addressed first.
   *
   * Off by default everywhere it is constructed. An AR companion that starts
   * conversations uninvited is the failure mode users abandon the product over,
   * so the permissive setting is the one that has to be chosen.
   */
  readonly allowProactiveSpeech: boolean;
  /** Whether new memories may be formed. Off means the companion still reads, never writes. */
  readonly allowMemoryFormation: boolean;
  /** Whether voice input may be captured. */
  readonly allowVoiceCapture: boolean;
  /**
   * Retention ceiling in days, or null for indefinite.
   *
   * `18_Memory_Architecture.md` makes memory the user's property; this is where
   * that becomes a number the forgetting pipeline can act on rather than a
   * promise in a document.
   */
  readonly memoryRetentionDays: number | null;
}

/**
 * The link between a user and one companion instance.
 *
 * Separate from `User` because the relation is not inherently one-to-one — the
 * same person may eventually have a companion on their glasses and another at
 * their desk with different histories. Modelling the join now costs one
 * interface; discovering it later means migrating every user-scoped table.
 */
export interface CompanionBinding {
  readonly userId: UserId;
  readonly companionId: CompanionId;
  readonly boundAt: Timestamp;
  /** False when the user has paused this companion without deleting it. */
  readonly active: boolean;
}

/** The privacy-preserving defaults. Every permission starts closed. */
export const defaultPreferences = (): UserPreferences => ({
  communicationStyle: null,
  allowProactiveSpeech: false,
  allowMemoryFormation: true,
  allowVoiceCapture: false,
  memoryRetentionDays: null,
});
