import type { CompanionId, RelationshipId, UserId } from '@nexa/shared';
import type {
  CommunicationStyle,
  RelationshipDimension,
  RelationshipType,
} from '../enums/relationship.js';
import type { Timestamp } from '../value-objects/timestamp.js';
import type { Metadata } from '../value-objects/metadata.js';

/**
 * What the companion and the user are to each other.
 *
 * The state that makes a companion different from an assistant. It changes
 * slowly, it is never reset, and it is the reason the same question can deserve
 * different answers six months apart.
 *
 * Every field here is the companion's *belief*. `17_Relationship_Engine.md`
 * requires this to be inspectable and correctable by the user, which is only
 * possible because none of it is inferred on demand — it is all recorded.
 */
export interface Relationship {
  readonly id: RelationshipId;
  readonly userId: UserId;
  readonly companionId: CompanionId;
  /** The overall stage. Derived from `dimensions`, stored so it is auditable. */
  readonly type: RelationshipType;
  /**
   * The independent axes, each 0–1.
   *
   * Separate because they genuinely diverge: heavy reliance with low trust is a
   * real and important configuration, and a single closeness number cannot
   * represent it.
   */
  readonly dimensions: RelationshipDimensions;
  /** Total exchanges. The main input to familiarity. */
  readonly interactionCount: number;
  readonly firstMetAt: Timestamp;
  readonly lastInteractionAt: Timestamp;
  /**
   * The style the companion has *learned* the user prefers.
   *
   * Never overrides `UserPreferences.communicationStyle`, which is stated
   * rather than inferred. A companion that overrules an explicit setting with
   * its own guess is one the user cannot configure.
   */
  readonly inferredStyle: CommunicationStyle | null;
  /**
   * Subjects the user has signalled they do not want raised.
   *
   * Stored on the relationship because it is a boundary between these two
   * parties, and honoured without exception — this is the one field in the
   * domain that only ever restricts behaviour.
   */
  readonly boundaries: readonly string[];
  /**
   * What the two of them have actually done together.
   *
   * Counts of interaction *kinds*, never content — this is the difference
   * between twenty planning sessions and twenty passing remarks, which should
   * not produce the same relationship. Memory holds what was said; this holds
   * only how often each shape of exchange occurred.
   */
  readonly counters: RelationshipCounters;
  readonly metadata: Metadata;
}

export type RelationshipDimensions = Readonly<Record<RelationshipDimension, number>>;

/**
 * Collaboration history, as counts.
 *
 * Deliberately four small integers rather than a log. A relationship needs to
 * know that it has been relied on and how often it has been wrong; it does not
 * need to know what about. Keeping this a set of counters is what stops the
 * relationship record becoming a second, unmanaged memory store with none of
 * memory's retention or deletion guarantees.
 */
export interface RelationshipCounters {
  /** Things the user asked to be done. The main input to reliance. */
  readonly requestsHandled: number;
  /** Exchanges where the user was planning something. Deeper than a request. */
  readonly plansSupported: number;
  /**
   * Times the user corrected the companion.
   *
   * Tracked because trust is earned by being right, and a companion corrected
   * constantly has not earned it. Not punitive on its own — see `signals.ts`,
   * where a correction costs less than an acknowledged uncertainty gains.
   */
  readonly correctionsReceived: number;
  /**
   * Times the companion said it did not know.
   *
   * Counted as a *positive*. `honesty` is identity's highest-precedence value,
   * and a companion that admits uncertainty is demonstrating exactly the
   * property trust should be built on.
   */
  readonly uncertaintiesAcknowledged: number;
}

/** No history yet. */
export const initialCounters = (): RelationshipCounters => ({
  requestsHandled: 0,
  plansSupported: 0,
  correctionsReceived: 0,
  uncertaintiesAcknowledged: 0,
});

/**
 * How much one interaction may move any dimension.
 *
 * Small, and deliberately so. `17_Relationship_Engine.md` requires gradual
 * change; a companion that reaches `trusted` after one good conversation has
 * not modelled trust, it has modelled enthusiasm. At this rate the stages take
 * weeks of real interaction, which is the intended pace.
 */
export const MAX_DIMENSION_DELTA_PER_INTERACTION = 0.02;

/**
 * The relationship at first contact.
 *
 * Trust starts at neither zero nor a half. A companion that begins suspicious
 * is unpleasant; one that begins fully trusting has nothing left to earn.
 */
export const initialRelationshipDimensions = (): RelationshipDimensions => ({
  trust: 0.3,
  familiarity: 0,
  warmth: 0.4,
  reliance: 0,
});
