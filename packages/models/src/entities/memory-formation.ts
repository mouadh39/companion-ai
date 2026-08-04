import type { MemoryId } from '@nexa/shared';
import type { ForgetReason, MemorySource, MemoryType } from '../enums/memory.js';
import type { ConfidenceScore, ImportanceScore, Valence } from '../value-objects/score.js';
import type { Timestamp } from '../value-objects/timestamp.js';
import type { Metadata } from '../value-objects/metadata.js';

/**
 * What a memory is *about*.
 *
 * Deliberately **orthogonal to `MemoryType`**, and the distinction is the whole
 * reason both exist. `MemoryType` says how a memory is encoded and therefore
 * how it should be *retrieved* — episodic memory is recency-weighted, semantic
 * memory is not. `MemorySubject` says what it concerns and therefore how long it
 * should *live* and how much it should matter.
 *
 * They cross freely. "They got the promotion" is `episodic` + `milestone`;
 * "they are a nurse" is `semantic` + `identity`; "they prefer short answers" is
 * `semantic` + `preference`. Collapsing the two into one enum would force a
 * choice between retrieving well and retaining well, and the same memory would
 * be mis-served by whichever axis lost.
 *
 * Retention policy attaches to the subject, not the type.
 */
export type MemorySubject =
  /** Who the user is. Name, work, where they live. Effectively permanent. */
  | 'identity'
  /** How they like things done. Long-lived and correctable. */
  | 'preference'
  /** Something they are working toward. Expires when it resolves. */
  | 'goal'
  /** An ongoing endeavour with no fixed end. */
  | 'project'
  /** Something that happened and mattered. Permanent — these are the story. */
  | 'milestone'
  /** People in their life, and what those people are to them. */
  | 'relationship'
  /** Context for right now. Expected to expire, and that is not a failure. */
  | 'temporary';

export const MEMORY_SUBJECTS = [
  'identity',
  'preference',
  'goal',
  'project',
  'milestone',
  'relationship',
  'temporary',
] as const satisfies readonly MemorySubject[];

/**
 * A memory offered to the formation engine.
 *
 * Richer than `MemoryCandidate`, which is what a *turn* emits — content, type,
 * source, tags and nothing else, because the turn is on the user's critical
 * path and has no business scoring anything. A proposal adds the signals
 * formation needs to decide whether this earns a place at all.
 *
 * `subject` is optional: a caller that already knows supplies it, and formation
 * classifies when it does not.
 */
export interface MemoryProposal {
  readonly content: string;
  readonly source: MemorySource;
  readonly tags: readonly string[];
  /** Known subject, or absent to have formation classify it. */
  readonly subject?: MemorySubject;
  /**
   * The user asked for this to be remembered in so many words.
   *
   * The single strongest signal available, and the one case where the engine's
   * own judgement is overruled: a companion that quietly declines to remember
   * something it was explicitly asked to remember has broken a promise the user
   * heard it make.
   */
  readonly statedExplicitly: boolean;
  /** How much the turn thought this mattered, 0–1. A hint, never a decision. */
  readonly salience: number;
}

/**
 * A memory formation has decided to write, before an id exists.
 *
 * No `id` and no `embedding`, for the same reason `MemoryCandidate` has
 * neither: both are assigned outside this engine. The id is stamped by the
 * caller so the engine stays free of randomness — the same rule `deliberate()`
 * follows — and the embedding is produced by the worker afterwards.
 */
export interface MemoryDraft {
  readonly type: MemoryType;
  readonly subject: MemorySubject;
  readonly content: string;
  readonly source: MemorySource;
  readonly tags: readonly string[];
  readonly createdAt: Timestamp;
  readonly importance: ImportanceScore;
  readonly confidence: ConfidenceScore;
  readonly valence: Valence;
  /** Null when the subject's policy says this should never expire. */
  readonly expiresAt: Timestamp | null;
  readonly relatedTo: readonly MemoryId[];
  readonly metadata: Metadata;
}

/**
 * What reinforcement does to an existing memory.
 *
 * Deltas rather than a replacement record, so the caller applies them to
 * whatever it has stored without the engine needing to have seen the whole
 * memory. It also keeps the change auditable: "confidence rose 0.05 because the
 * user said it again" survives into the store, where a wholesale overwrite
 * would not.
 */
export interface Reinforcement {
  readonly confidenceDelta: number;
  readonly importanceDelta: number;
  /** The new expiry, extended because the memory proved live. Null if permanent. */
  readonly expiresAt: Timestamp | null;
  readonly reinforcedAt: Timestamp;
}

/** Why a proposal did not become a memory. */
export type FormationRejection =
  /** The user has memory formation switched off. Checked before anything else. */
  | 'formation_disabled'
  /** Nothing to remember. */
  | 'empty_content'
  /** Scored below the floor its subject requires. */
  | 'below_importance_floor'
  /** Too uncertain to be worth asserting later. */
  | 'below_confidence_floor'
  /** Already known, and the existing memory is at least as good. */
  | 'already_known';

export const FORMATION_REJECTIONS = [
  'formation_disabled',
  'empty_content',
  'below_importance_floor',
  'below_confidence_floor',
  'already_known',
] as const satisfies readonly FormationRejection[];

/** Why formation decided as it did. */
export type FormationReasonCode =
  | 'explicitly_requested'
  | 'subject_classified'
  | 'importance_scored'
  | 'confidence_from_source'
  | 'duplicate_detected'
  | 'conflict_detected'
  | 'supersedes_older'
  | 'reinforces_existing'
  | 'retention_applied'
  | 'user_retention_limit'
  | 'below_threshold';

export const FORMATION_REASON_CODES = [
  'explicitly_requested',
  'subject_classified',
  'importance_scored',
  'confidence_from_source',
  'duplicate_detected',
  'conflict_detected',
  'supersedes_older',
  'reinforces_existing',
  'retention_applied',
  'user_retention_limit',
  'below_threshold',
] as const satisfies readonly FormationReasonCode[];

export interface FormationReason {
  readonly code: FormationReasonCode;
  readonly detail: string;
}

/**
 * What formation decided.
 *
 * A discriminated union rather than a record with optional fields, so a caller
 * cannot read `draft` on a rejection or `targetId` on a store. The four
 * outcomes need genuinely different follow-up work — one writes, one patches,
 * one writes *and* patches, one does nothing — and a shape that let them be
 * confused would put the difference in a runtime check nobody performs.
 */
export type FormationDecision =
  | {
      readonly outcome: 'store';
      readonly draft: MemoryDraft;
      readonly reasons: readonly FormationReason[];
    }
  | {
      readonly outcome: 'reinforce';
      readonly targetId: MemoryId;
      readonly reinforcement: Reinforcement;
      readonly reasons: readonly FormationReason[];
    }
  | {
      readonly outcome: 'supersede';
      /** The memory this replaces. Marked `superseded`, never deleted. */
      readonly targetId: MemoryId;
      readonly draft: MemoryDraft;
      readonly reasons: readonly FormationReason[];
    }
  | {
      readonly outcome: 'reject';
      readonly reason: FormationRejection;
      readonly reasons: readonly FormationReason[];
    };

/**
 * A memory that should leave circulation, and why.
 *
 * `reason` reuses the existing `ForgetReason` union — forgetting is one
 * vocabulary whether triggered by expiry, decay, or the user asking.
 */
export interface ForgetDecision {
  readonly memoryId: MemoryId;
  readonly reason: ForgetReason;
  readonly detail: string;
}
