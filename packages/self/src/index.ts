/**
 * `@nexa/self` — what the companion can truthfully say about itself.
 *
 * A derivation, not a store. It joins four sources that each own their own
 * layer — the frozen identity catalogue, the faculties the composition root
 * wired, what the connected client declared, and what the body reported — into
 * one answer per capability.
 *
 * It is deliberately separate from `@nexa/identity`. That package is frozen,
 * versioned and permanent; this one is recomputed every turn and never stored.
 * Folding them together would put volatile runtime state inside the one record
 * whose entire value is that it does not drift.
 */
export type { FacultyFacts, ResolveRequest } from './resolve.js';
export { resolveSelf, resolveCapabilities, resolveSkills } from './resolve.js';
