import type {
  BudgetSpend,
  ExcludedCandidate,
  RetrievalBudget,
  RetrievalClass,
} from '@nexa/models';
import { RETRIEVAL_CLASSES } from '@nexa/models';
import { CLASS_POLICIES } from './classes.js';
import type { Ranked } from './rank.js';

/**
 * Deciding how much of what survived the ranking actually fits.
 *
 * Three ceilings, applied in a fixed order, and the order is the policy:
 *
 * 1. **Reserved slots**, class by class in a fixed name order.
 * 2. **Open competition**, in rank order, under the per-class caps.
 * 3. **Token accounting**, throughout.
 *
 * Reserved first is what makes a reservation mean anything: filled after open
 * competition, a class whose slot was reserved would already have lost them.
 * And reservations do *not* relax the relevance floor — only admitted candidates
 * are ever passed in here, so a reserve on a class with nothing relevant to say
 * simply goes unused, which is the intended behaviour rather than a gap.
 */

export interface FitResult {
  readonly kept: readonly Ranked[];
  readonly excluded: readonly ExcludedCandidate[];
  readonly spend: BudgetSpend;
  readonly boundByItems: boolean;
  readonly boundByTokens: boolean;
}

export const defaultBudget = (maxItems = 12, maxTokens = 4_000): RetrievalBudget => ({
  maxItems,
  maxTokens,
  maxPerClass: Object.fromEntries(
    RETRIEVAL_CLASSES.map((name) => [name, CLASS_POLICIES[name].defaultCap]),
  ),
  reserved: {},
});

/**
 * Fills the budget.
 *
 * `estimate` is supplied rather than computed here so the caller can use the
 * same tokeniser its model actually bills on. The default is a character
 * heuristic, which is wrong by a few percent and wrong *consistently* — and a
 * consistent estimate is what a budget needs, since the point is to bound the
 * result rather than to predict a bill.
 */
export const fit = (
  ranked: readonly Ranked[],
  budget: RetrievalBudget,
  estimate: (text: string) => number,
): FitResult => {
  const kept: Ranked[] = [];
  const excluded: ExcludedCandidate[] = [];
  const perClass = new Map<RetrievalClass, number>();
  const taken = new Set<string>();

  let tokens = 0;
  let boundByItems = false;
  let boundByTokens = false;

  const capFor = (name: RetrievalClass): number =>
    budget.maxPerClass[name] ?? Number.POSITIVE_INFINITY;

  const admit = (entry: Ranked): 'taken' | 'items' | 'tokens' | 'class' => {
    if (kept.length >= budget.maxItems) return 'items';

    const name = entry.candidate.retrievalClass;
    if ((perClass.get(name) ?? 0) >= capFor(name)) return 'class';

    const cost = estimate(entry.candidate.text);
    if (tokens + cost > budget.maxTokens) return 'tokens';

    kept.push(entry);
    taken.add(entry.candidate.id);
    perClass.set(name, (perClass.get(name) ?? 0) + 1);
    tokens += cost;
    return 'taken';
  };

  // ── 1. reserved ────────────────────────────────────────────────────────
  // Iterated over the declared class order rather than over the object's own
  // keys, so two budgets with the same reservations in a different literal
  // order fill identically.
  for (const name of RETRIEVAL_CLASSES) {
    const reserve = budget.reserved[name] ?? 0;
    if (reserve === 0) continue;

    let filled = 0;
    for (const entry of ranked) {
      if (filled >= reserve) break;
      if (taken.has(entry.candidate.id)) continue;
      if (entry.candidate.retrievalClass !== name) continue;
      if (admit(entry) === 'taken') filled++;
    }
  }

  // ── 2 & 3. open competition, under both remaining ceilings ─────────────
  for (const entry of ranked) {
    if (taken.has(entry.candidate.id)) continue;

    const outcome = admit(entry);
    if (outcome === 'taken') continue;

    if (outcome === 'items') boundByItems = true;
    if (outcome === 'tokens') boundByTokens = true;

    excluded.push({
      id: entry.candidate.id,
      source: entry.candidate.payload.source,
      retrievalClass: entry.candidate.retrievalClass,
      reason:
        outcome === 'items'
          ? 'budget_items'
          : outcome === 'tokens'
            ? 'budget_tokens'
            : 'class_cap',
      detail: DETAIL[outcome](entry, budget),
      bestSignal: entry.anchor,
      bestSignalStrength: entry.anchorStrength,
    });

    // Deliberately **not** a break on `items`. Continuing costs one comparison
    // per remaining candidate and buys two things: an honest exclusion record
    // for everything that lost rather than for the first loser only, and — when
    // the binding ceiling was tokens — the chance that a shorter item further
    // down still fits. Stopping at the first over-budget item leaves budget
    // unspent for no reason beyond the convenience of the loop.
  }

  return {
    kept,
    excluded,
    spend: {
      items: kept.length,
      tokens,
      perClass: Object.fromEntries(perClass),
    },
    boundByItems,
    boundByTokens,
  };
};

const DETAIL: Readonly<
  Record<'items' | 'tokens' | 'class', (entry: Ranked, budget: RetrievalBudget) => string>
> = {
  items: (_, budget) => `The ${budget.maxItems}-item budget was already full.`,
  tokens: (entry, budget) =>
    `Would not fit the ${budget.maxTokens}-token budget at ${entry.candidate.text.length} characters.`,
  class: (entry, budget) =>
    `'${entry.candidate.retrievalClass}' had taken its ${budget.maxPerClass[entry.candidate.retrievalClass] ?? 0} slots.`,
};

/**
 * The default token estimate: four characters to a token.
 *
 * A heuristic, and named as one. Real tokenisers are model-specific and would be
 * a dependency this package will not take; what a budget needs is a bound that
 * is stable across runs and roughly right, which this is. A caller that cares
 * about the last few percent supplies its own.
 */
export const estimateTokens = (text: string): number => Math.ceil(text.length / 4);
