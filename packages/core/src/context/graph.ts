import type { PortOutcome } from '@nexa/models';
import type { PortCall, PortOptions } from '../execution/index.js';
import { callPort } from '../execution/index.js';
import { ContributorCycleError, UnknownContributorError } from '../errors.js';
import type {
  AnyContribution,
  ContributionRequest,
  ContributorKey,
  ContributorView,
} from './contributor.js';

/**
 * Contributors grouped into waves, each wave safe to run in parallel.
 *
 * Waves rather than a single fan-out because contributions are not all
 * independent — retrieval consumes goals, planning will consume goals and the
 * world, emotion may consume retrieved memories. Waves rather than a full
 * async dependency resolution because a wave boundary is a place the scheduler
 * can be inspected, timed, and reasoned about; a tangle of interlocking
 * promises is none of those things.
 */
export type ContributionWaves = readonly (readonly AnyContribution[])[];

/**
 * Sorts contributions into dependency-ordered waves.
 *
 * Both failure modes here are startup failures with a named cause rather than
 * runtime surprises, which is the same trade `EventRegistry` makes for
 * duplicate event types: a cycle discovered at boot costs a restart, a cycle
 * discovered in production costs a turn that silently read an empty dependency.
 */
export const planWaves = (contributions: readonly AnyContribution[]): ContributionWaves => {
  const byId = new Map<string, AnyContribution>();
  for (const contribution of contributions) {
    if (byId.has(contribution.key.id)) {
      throw new UnknownContributorError(
        contribution.key.id,
        'registered twice; contributor ids must be unique',
      );
    }
    byId.set(contribution.key.id, contribution);
  }

  for (const contribution of contributions) {
    for (const dependency of contribution.dependsOn) {
      if (!byId.has(dependency.id)) {
        throw new UnknownContributorError(
          dependency.id,
          `required by '${contribution.key.id}' but not registered`,
        );
      }
    }
  }

  const waves: AnyContribution[][] = [];
  const settled = new Set<string>();
  let remaining = [...contributions];

  while (remaining.length > 0) {
    const wave = remaining.filter((contribution) =>
      contribution.dependsOn.every((dependency) => settled.has(dependency.id)),
    );

    // A pass that frees nothing means every remaining contributor is waiting on
    // another remaining contributor: that is a cycle, and no ordering exists.
    if (wave.length === 0) {
      throw new ContributorCycleError(remaining.map((contribution) => contribution.key.id));
    }

    waves.push(wave);
    for (const contribution of wave) settled.add(contribution.key.id);
    remaining = remaining.filter((contribution) => !settled.has(contribution.key.id));
  }

  return waves;
};

/** Everything one assembly pass produced, successes and failures alike. */
export interface ContributionRun {
  readonly values: ReadonlyMap<string, unknown>;
  readonly outcomes: ReadonlyMap<string, PortOutcome>;
  readonly calls: readonly PortCall<unknown>[];
  /**
   * The required contributor that failed, when one did.
   *
   * Reported rather than thrown so the calls collected before the failure
   * survive into the turn record — a turn that failed is the one whose port
   * timings you most need.
   */
  readonly failure: { readonly id: string; readonly outcome: PortOutcome } | null;
  /** True when the turn was cancelled mid-assembly. */
  readonly aborted: boolean;
}

/**
 * Runs the waves, in order, each wave in parallel.
 *
 * Every contributor is called through `callPort`, so all of them share one
 * budget policy, one cancellation policy, and one failure classification. A
 * contributor that invented its own would degrade differently from the rest of
 * the pipeline, which is how a system ends up with two answers to "what happens
 * when this is slow?".
 */
export const runContributions = async (
  waves: ContributionWaves,
  request: ContributionRequest,
  options: PortOptions,
): Promise<ContributionRun> => {
  const values = new Map<string, unknown>();
  const outcomes = new Map<string, PortOutcome>();
  const calls: PortCall<unknown>[] = [];

  for (const wave of waves) {
    const results = await Promise.all(
      wave.map(async (contribution) => {
        const view = viewFor(request, contribution, values, outcomes);
        const call = await callPort(
          contribution.key.id,
          contribution.budgetMs,
          options,
          (scoped) => contribution.contribute(view, scoped),
        );
        return { contribution, call };
      }),
    );

    for (const { contribution, call } of results) {
      calls.push(call);
      outcomes.set(contribution.key.id, call.outcome);
      if (call.outcome === 'ok') values.set(contribution.key.id, call.value);
    }

    // Checked between waves rather than at the end: a turn whose identity has
    // already failed has no reason to pay for the waves that follow.
    for (const { call } of results) {
      if (call.outcome === 'aborted') {
        return { values, outcomes, calls, failure: null, aborted: true };
      }
    }

    for (const { contribution, call } of results) {
      if (contribution.required && call.outcome !== 'ok') {
        return {
          values,
          outcomes,
          calls,
          failure: { id: contribution.key.id, outcome: call.outcome },
          aborted: false,
        };
      }
    }
  }

  return { values, outcomes, calls, failure: null, aborted: false };
};

/**
 * A view restricted to what this contributor declared it depends on.
 *
 * The restriction is the point. If a contributor could read anything already
 * computed, the declared graph would stop describing the real one: a hidden
 * edge would work by accident of wave ordering and break the day an unrelated
 * contributor is added.
 */
const viewFor = (
  request: ContributionRequest,
  contribution: AnyContribution,
  values: ReadonlyMap<string, unknown>,
  outcomes: ReadonlyMap<string, PortOutcome>,
): ContributorView => {
  const declared = new Set(contribution.dependsOn.map((dependency) => dependency.id));

  return {
    ...request,
    get: <T>(key: ContributorKey<T>): T | undefined => {
      if (!declared.has(key.id)) return undefined;
      // The one cast in the scheme, and the reason `ContributorKey` carries a
      // phantom type: the map is heterogeneous, but a key's id and its value
      // type were fixed together at declaration, so this is sound as long as
      // ids stay unique — which `planWaves` enforces at construction.
      return values.get(key.id) as T | undefined;
    },
    outcomeOf: (key: ContributorKey<unknown>): PortOutcome | undefined =>
      declared.has(key.id) ? outcomes.get(key.id) : undefined,
  };
};
