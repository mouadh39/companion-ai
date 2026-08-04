import type { PlanConstraint, Strategy, StrategyEvaluation } from '@nexa/models';
import { STRATEGIES, STRATEGY_PRIORITY } from '@nexa/models';
import type { Situation } from './situation.js';
import { blocksFor, policyFor } from './strategies.js';

/**
 * Weighing every option and choosing one, without ever choosing at random.
 *
 * Every strategy is evaluated — including the ones that are ruled out — and
 * every evaluation is kept. That is what makes "why not option B?" answerable
 * from the plan alone, and it costs nothing worth saving: the set is closed and
 * has eleven members.
 *
 * ## Admissibility is decided before score
 *
 * A strategy blocked by a constraint is not a low-scoring option. It is not an
 * option, and its score is not consulted. Folding the two together — a large
 * negative weight for "clarification required", say — would mean a sufficiently
 * strong preference for answering could outvote a safety requirement, which is
 * exactly the failure constraints exist to prevent.
 */

export interface Selection {
  readonly chosen: Strategy;
  /** Every strategy, ranked. Inadmissible ones carry their blocks and no rank. */
  readonly evaluations: readonly StrategyEvaluation[];
  /** The best admissible alternative, or null when only one was available. */
  readonly runnerUp: Strategy | null;
}

/**
 * The deterministic order: score, then how little the strategy presumes.
 *
 * The tie-break is `STRATEGY_PRIORITY`, which is ordered from most careful to
 * most assertive. So two options that argue equally well resolve toward the one
 * that assumes less — "prefer asking over assuming" as an ordering rather than
 * as a special case someone has to remember to write.
 *
 * No third key is needed and none is provided: the priority table is a total
 * order over a closed set, so two evaluations can never tie all the way down.
 */
const byScore = (a: StrategyEvaluation, b: StrategyEvaluation): number =>
  b.score - a.score || STRATEGY_PRIORITY[a.strategy] - STRATEGY_PRIORITY[b.strategy];

export const evaluate = (
  situation: Situation,
  constraints: readonly PlanConstraint[],
): readonly StrategyEvaluation[] =>
  STRATEGIES.map((strategy) => {
    const blockedBy = blocksFor(strategy, constraints);
    const considerations = policyFor(strategy).weigh(situation);

    return {
      strategy,
      admissible: blockedBy.length === 0,
      blockedBy,
      considerations,
      score: round(
        considerations.reduce((total, consideration) => total + consideration.weight, 0),
      ),
      rank: null,
    };
  });

/**
 * Chooses, and records what nearly happened instead.
 *
 * `clarify_first` is the guaranteed fallback and is blocked by nothing, so there
 * is always at least one admissible option and this function is total. That is a
 * property of the table rather than of a guard here — a strategy set where every
 * option could be ruled out would leave the planner with nothing to do, and
 * asking is never the wrong thing to be left with.
 */
export const select = (
  situation: Situation,
  constraints: readonly PlanConstraint[],
): Selection => {
  const evaluated = evaluate(situation, constraints);

  const admissible = evaluated
    .filter((evaluation) => evaluation.admissible)
    .sort(byScore);

  const ranked = new Map<Strategy, number>(
    admissible.map((evaluation, index) => [evaluation.strategy, index + 1]),
  );

  const evaluations = evaluated
    .map((evaluation) => ({
      ...evaluation,
      rank: ranked.get(evaluation.strategy) ?? null,
    }))
    // Reported in rank order, inadmissible ones last in declared order, so the
    // list reads as an argument rather than as a dump.
    .sort((a, b) => {
      if (a.rank === null && b.rank === null) {
        return STRATEGY_PRIORITY[a.strategy] - STRATEGY_PRIORITY[b.strategy];
      }
      if (a.rank === null) return 1;
      if (b.rank === null) return -1;
      return a.rank - b.rank;
    });

  const chosen = admissible[0]?.strategy ?? 'clarify_first';
  const runnerUp = admissible[1]?.strategy ?? null;

  return { chosen, evaluations, runnerUp };
};

const round = (value: number): number => Math.round(value * 1_000) / 1_000;
