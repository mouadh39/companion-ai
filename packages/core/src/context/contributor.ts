import type { CompanionId, TurnId, UserId } from '@nexa/shared';
import type {
  ClientCapabilities,
  ContextSection,
  Perception,
  PortOutcome,
} from '@nexa/models';
import type { PortOptions } from '../execution/index.js';

/**
 * A typed handle for one contributor's output.
 *
 * The phantom type parameter is what keeps the view type-safe. Without it, a
 * dependent would have to write `view.get('goals') as Goal[]`, and a cast at
 * every read is a cast that eventually disagrees with what the producer
 * actually returns. Here the single unavoidable cast lives inside the view
 * implementation, checked once, rather than at every consumer.
 */
export interface ContributorKey<T> {
  readonly id: string;
  /** Which region of the prompt this feeds. Used for budgeting and omissions. */
  readonly section: ContextSection;
  /**
   * Never present at runtime. It exists only so TypeScript can carry `T` from
   * the declaration of a key to the reads of it.
   *
   * Declared as a bare `T` rather than a function taking one, which makes the
   * key *covariant*: a `ContributorKey<Goal[]>` is then assignable to
   * `ContributorKey<unknown>`, and the scheduler can hold a heterogeneous list
   * of contributions without an unsafe widening at every registration.
   */
  readonly phantom?: T;
}

export const contributorKey = <T>(
  id: string,
  section: ContextSection,
): ContributorKey<T> => ({ id, section });

/** What a contributor knows about the turn, independent of any other contributor. */
export interface ContributionRequest {
  readonly turnId: TurnId;
  readonly companionId: CompanionId;
  readonly userId: UserId;
  readonly perception: Perception;
  /**
   * What the connected client declared it can execute, or null when it declared
   * nothing.
   *
   * A fact about the turn in exactly the way `perception` is: carried through
   * from the request rather than fetched, owned by no contributor, and true for
   * the whole pass. It is here because resolving what the companion can
   * presently do requires knowing what this session can render — a capability
   * the backend has and the client cannot receive is not one the companion may
   * offer.
   */
  readonly clientCapabilities: ClientCapabilities | null;
}

/**
 * Read access to earlier waves.
 *
 * Read-only by design: a contributor consumes what came before and produces its
 * own value, and that is the whole extent of the interaction. Allowing writes
 * here would turn a single deterministic pass into a blackboard whose result
 * depends on scheduling order — which is precisely the property this pipeline
 * exists to avoid.
 */
export interface ContributorView extends ContributionRequest {
  /**
   * The dependency's value, or undefined when it did not produce one.
   *
   * Only declared dependencies are readable. Reading an undeclared key returns
   * undefined even if that contributor ran, because otherwise the declared
   * graph would stop describing the real one and wave ordering would become a
   * lie.
   */
  get<T>(key: ContributorKey<T>): T | undefined;

  /**
   * Why a dependency's value is missing.
   *
   * The reason a dependent is *told* rather than simply handed an empty value.
   * "No goals exist" and "the goal service timed out" call for different
   * behaviour — the first is a fact about the companion, the second is a fact
   * about the infrastructure — and an empty array cannot distinguish them.
   */
  outcomeOf(key: ContributorKey<unknown>): PortOutcome | undefined;
}

/**
 * One engine's contribution to the shared cognitive state.
 *
 * This replaces the hand-written phase ordering in `ContextAssembler`, where
 * goals were fetched alone and everything else in one parallel block because
 * retrieval happens to consume goals. That worked at two phases. At six
 * contributors with a handful of edges it becomes a place bugs hide: a
 * contributor added to the wrong phase silently reads an empty dependency, and
 * nothing fails.
 *
 * Declaring the edge instead makes the graph inspectable, validates it at
 * construction, and turns adding Calendar, Health or Finance into declaring a
 * contributor rather than editing a scheduler.
 */
export interface ContextContribution<T> {
  readonly key: ContributorKey<T>;
  /** Must have produced (or failed) before this runs. Validated at construction. */
  readonly dependsOn: readonly ContributorKey<unknown>[];
  /**
   * Whether the turn can proceed without this.
   *
   * True for identity and personality only — the two sections without which the
   * companion is not itself. Everything else is optional by construction, which
   * is what makes "degrade, never fail" a property of the design rather than a
   * rule people have to remember.
   */
  readonly required: boolean;
  /** Time ceiling for this contributor, bounded by the assembly deadline. */
  readonly budgetMs: number;
  contribute(view: ContributorView, options: PortOptions): Promise<T>;
}

/** Any contribution, for the heterogeneous list the scheduler works over. */
export type AnyContribution = ContextContribution<unknown>;
