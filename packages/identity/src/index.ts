/**
 * `@nexa/identity` — who Nexa is. The canonical record.
 *
 * Layer 1 of `13_Personality_Engine.md`, and the one layer that does not move.
 * Personality adapts, relationships grow, memory changes, conversation changes.
 * This does not.
 *
 * The profile is a **frozen constant**, not a stored row. Identity that lives
 * in a database is identity a migration can edit, and the single thing this
 * package promises is that it does not drift. Every query is pure and total,
 * so an explanation produced today for a turn recorded in March can be
 * regenerated exactly.
 *
 * ## It holds no prose
 *
 * There is no paragraph here anyone is meant to speak. Every entry is a
 * structured fact or a short declarative statement; rendering them into language
 * belongs to the conversation engine. A stored sentence would be a prompt in the
 * one place that must survive every model change.
 *
 * ## The vocabulary lives in `@nexa/models`
 *
 * `IdentityProfile`, `SelfAnswer`, `UncertaintyStance` and the rest sit one
 * layer down, because `@nexa/core` may never import a capability package — so
 * anything Core or a sibling engine reads has to be beneath both. This package
 * holds the *values*, not their shapes.
 */

export { currentIdentity, identityAt, identityVersions } from './engine/registry.js';

export {
  valuesByPrecedence,
  resolveValueConflict,
  commitmentsOfKind,
  enforceableCommitments,
  capabilitiesByMaturity,
  presentTenseCapabilities,
  permanentLimitations,
  temporaryLimitations,
  boundaryFor,
  uncertaintyFor,
  selfAnswer,
  introductionFor,
  allProhibitions,
  isInvariant,
} from './engine/queries.js';

// The catalogues are exported directly as well as through the profile. A
// consumer that needs only the limitations should not have to reach through a
// profile it does not otherwise use, and these are the same frozen arrays the
// profile holds rather than copies.
export { VALUES, COMMITMENTS, AUTONOMY } from './identity/values.js';
export { INVARIANTS, NEXA_IDENTITY_V1 } from './identity/profile.js';
export { CAPABILITIES } from './capabilities/catalogue.js';
export { LIMITATIONS } from './limitations/catalogue.js';
export { KNOWLEDGE_BOUNDARIES } from './limitations/boundaries.js';
export { UNCERTAINTY_STANCES } from './responses/uncertainty.js';
export { SELF_ANSWERS } from './responses/self.js';
export { INTRODUCTIONS } from './responses/introduction.js';
