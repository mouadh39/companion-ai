/**
 * Context assembly: what each engine contributes, and in what order.
 *
 * The shared cognitive state is `CognitiveContext` itself — one immutable
 * structure every engine contributes into and deliberation reads once. What
 * lives here is the *scheduling* of those contributions, which is the only part
 * of the blackboard idea Nexa adopts: dependency-ordered contribution, without
 * write-back and without an opportunistic control loop.
 *
 * Those two omissions are deliberate. Write-back would make the decision a
 * function of the sequence of writes rather than of a value, and replay would
 * have to reproduce the interleaving. Opportunistic re-triggering would make
 * the same inputs yield different decisions depending on which contributor won
 * a race, and would give the turn no upper bound on a path a user is waiting on.
 */
export type {
  ContributorKey,
  ContributionRequest,
  ContributorView,
  ContextContribution,
  AnyContribution,
} from './contributor.js';
export { contributorKey } from './contributor.js';

export type { ContributionWaves, ContributionRun } from './graph.js';
export { planWaves, runContributions } from './graph.js';
