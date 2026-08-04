import type { MemorySubject, MemoryType } from '@nexa/models';

/**
 * What each subject costs to keep, and what it must be worth.
 *
 * This table is where "a memory must earn its place" stops being a slogan.
 * Every proposal is measured against the policy for its subject, and one that
 * cannot clear the floor is not stored — not stored at low priority, not stored
 * with a short life. Not stored.
 *
 * The asymmetry across subjects is the design. Getting an `identity` fact wrong
 * is expensive and getting it *missing* is worse, so it demands high confidence
 * and then keeps it forever. A `temporary` fact is cheap to lose and cheap to
 * re-derive, so it demands almost nothing and expires in a day. Applying one
 * policy to both would either fill the store with noise or drop the things the
 * companion most needs to know.
 */
export interface SubjectPolicy {
  readonly subject: MemorySubject;
  /**
   * The encoding this subject usually implies.
   *
   * A default, not a rule — a caller that knows better supplies the type. It
   * exists because most subjects map cleanly: identity facts are `semantic`,
   * milestones are things that happened and so `episodic`.
   */
  readonly defaultType: MemoryType;
  /** Below this, the proposal is rejected outright. */
  readonly importanceFloor: number;
  /** Where a proposal with no other signal starts. */
  readonly baseImportance: number;
  /** Below this confidence, not worth asserting later. */
  readonly confidenceFloor: number;
  /** Days until expiry, or null to never expire. */
  readonly ttlDays: number | null;
  /**
   * Whether a newer, conflicting fact may replace this.
   *
   * `milestone` is the one that cannot. A thing that happened does not stop
   * having happened because something else happened later — superseding it
   * would rewrite history rather than update a belief.
   */
  readonly supersedable: boolean;
  /** How much each re-observation extends the life of a memory, in days. */
  readonly reinforcementExtensionDays: number;
}

export const SUBJECT_POLICIES: Readonly<Record<MemorySubject, SubjectPolicy>> = {
  /**
   * Who the user is. The most expensive thing to be wrong about and the most
   * expensive to lack, so it demands the highest confidence and then never
   * expires.
   */
  identity: {
    subject: 'identity',
    defaultType: 'semantic',
    importanceFloor: 0.5,
    baseImportance: 0.85,
    confidenceFloor: 0.6,
    ttlDays: null,
    supersedable: true,
    reinforcementExtensionDays: 0,
  },

  /**
   * How they like things done. Long-lived but readily corrected — a preference
   * the user has changed is not a preference the companion should defend.
   */
  preference: {
    subject: 'preference',
    defaultType: 'semantic',
    importanceFloor: 0.3,
    baseImportance: 0.6,
    confidenceFloor: 0.45,
    ttlDays: 730,
    supersedable: true,
    reinforcementExtensionDays: 365,
  },

  /**
   * Something they are working toward. Expires by default because most goals
   * quietly stop being goals, and a companion still asking about last year's
   * intentions is worse than one that forgot.
   */
  goal: {
    subject: 'goal',
    defaultType: 'semantic',
    importanceFloor: 0.35,
    baseImportance: 0.7,
    confidenceFloor: 0.45,
    ttlDays: 180,
    supersedable: true,
    reinforcementExtensionDays: 120,
  },

  /** An ongoing endeavour. Longer-lived than a goal, still not permanent. */
  project: {
    subject: 'project',
    defaultType: 'semantic',
    importanceFloor: 0.3,
    baseImportance: 0.6,
    confidenceFloor: 0.45,
    ttlDays: 365,
    supersedable: true,
    reinforcementExtensionDays: 180,
  },

  /**
   * Something that happened and mattered. Permanent and never superseded —
   * these are the shared history that makes a companion a companion, and a
   * later event does not undo an earlier one.
   */
  milestone: {
    subject: 'milestone',
    defaultType: 'episodic',
    importanceFloor: 0.4,
    baseImportance: 0.8,
    confidenceFloor: 0.5,
    ttlDays: null,
    supersedable: false,
    reinforcementExtensionDays: 0,
  },

  /** People in their life. Long-lived; relationships change but slowly. */
  relationship: {
    subject: 'relationship',
    defaultType: 'relational',
    importanceFloor: 0.35,
    baseImportance: 0.65,
    confidenceFloor: 0.5,
    ttlDays: 730,
    supersedable: true,
    reinforcementExtensionDays: 365,
  },

  /**
   * Context for right now.
   *
   * The floor is low because the cost of keeping one briefly is near zero, and
   * the TTL is short because the cost of keeping them *all* forever is the
   * clutter `18_Memory_Architecture.md` says forgetting exists to prevent.
   * These expiring is the system working.
   */
  temporary: {
    subject: 'temporary',
    defaultType: 'episodic',
    importanceFloor: 0.1,
    baseImportance: 0.25,
    confidenceFloor: 0.3,
    ttlDays: 1,
    supersedable: true,
    reinforcementExtensionDays: 1,
  },
};

export const policyFor = (subject: MemorySubject): SubjectPolicy =>
  SUBJECT_POLICIES[subject];
