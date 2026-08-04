import type { IdentityProfile } from '@nexa/models';
import { NEXA_IDENTITY_V1 } from '../identity/profile.js';

/**
 * Every published identity version, by number.
 *
 * This exists for replay. A turn recorded six months ago was produced by the
 * identity of that moment, and explaining it against today's identity would be
 * a quiet lie — the same class of error as replaying a decision against
 * re-requested context rather than the context that was logged.
 *
 * One entry today. The registry is not premature: the alternative is a single
 * exported constant, and the first revision would then have nowhere to put the
 * old one, at which point every historical turn record becomes unexplainable.
 * The cost of the map is one file; the cost of not having it is unrecoverable.
 *
 * ## The rule
 *
 * **A published version is immutable.** Adding a value, reordering precedence,
 * softening a commitment, or removing an invariant is a new entry with a new
 * number. Correcting a `maturity` on a capability is *not* — that is a factual
 * update about what the system can do, not a change to what it is.
 */
const REGISTRY: ReadonlyMap<number, IdentityProfile> = new Map([
  [NEXA_IDENTITY_V1.version, NEXA_IDENTITY_V1],
]);

/** The identity in force now. What every live turn should use. */
export const currentIdentity = (): IdentityProfile => NEXA_IDENTITY_V1;

/**
 * The identity as it stood at a given version.
 *
 * Returns `null` rather than falling back to current. A replay that silently
 * used today's identity for a turn recorded under version 1 would produce a
 * confident, wrong explanation — worse than admitting the version is missing,
 * because nothing downstream could tell the difference.
 */
export const identityAt = (version: number): IdentityProfile | null =>
  REGISTRY.get(version) ?? null;

/** Every published version number, ascending. */
export const identityVersions = (): readonly number[] =>
  [...REGISTRY.keys()].sort((a, b) => a - b);
