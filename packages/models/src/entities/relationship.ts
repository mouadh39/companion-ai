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
  readonly metadata: Metadata;
}

export type RelationshipDimensions = Readonly<Record<RelationshipDimension, number>>;

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
