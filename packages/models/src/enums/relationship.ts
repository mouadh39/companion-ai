/**
 * The stage a relationship has reached.
 *
 * Stages, not a score, because behaviour changes in steps rather than smoothly:
 * the difference between `new` and `familiar` is whether the companion may use
 * shorthand and reference shared history. A continuous "closeness" number
 * cannot be read off at a decision point without inventing thresholds anyway,
 * so the thresholds are the model.
 *
 * `17_Relationship_Engine.md` requires this to move slowly. Progression is
 * earned through interaction count and elapsed time together; nothing here
 * should be reachable in one enthusiastic conversation.
 */
export type RelationshipType = 'new' | 'acquainted' | 'familiar' | 'close' | 'trusted';

export const RELATIONSHIP_TYPES = [
  'new',
  'acquainted',
  'familiar',
  'close',
  'trusted',
] as const satisfies readonly RelationshipType[];

/**
 * Ordering, so progression and regression are comparable.
 *
 * Regression is possible and deliberate. A relationship that only ever advances
 * is not a relationship being modelled, it is a counter.
 */
export const RELATIONSHIP_RANK = {
  new: 0,
  acquainted: 1,
  familiar: 2,
  close: 3,
  trusted: 4,
} as const satisfies Readonly<Record<RelationshipType, number>>;

export const compareRelationships = (a: RelationshipType, b: RelationshipType): number =>
  RELATIONSHIP_RANK[a] - RELATIONSHIP_RANK[b];

/**
 * The dimensions tracked independently of the overall stage.
 *
 * Separate because they move independently. Someone can be highly familiar and
 * not especially trusting, and collapsing that into one number loses precisely
 * the distinction that should change how the companion speaks.
 */
export type RelationshipDimension = 'trust' | 'familiarity' | 'warmth' | 'reliance';

export const RELATIONSHIP_DIMENSIONS = [
  'trust',
  'familiarity',
  'warmth',
  'reliance',
] as const satisfies readonly RelationshipDimension[];

/**
 * How the user prefers to be communicated with.
 *
 * Held on the relationship rather than on the user because it is learned from
 * interaction rather than configured, and because it is the companion's
 * *belief* about a preference — which can be wrong, and should be correctable.
 */
export type CommunicationStyle = 'direct' | 'detailed' | 'socratic' | 'encouraging' | 'concise';

export const COMMUNICATION_STYLES = [
  'direct',
  'detailed',
  'socratic',
  'encouraging',
  'concise',
] as const satisfies readonly CommunicationStyle[];
