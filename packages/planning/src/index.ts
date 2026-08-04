/**
 * `@nexa/planning` — deciding how the conversation should proceed.
 *
 * The last cognitive layer before generation, and the one that reads all the
 * others. Identity, personality, relationship, memory, reflection, retrieval and
 * perception each answer a piece of "what does the companion know?"; this
 * answers "so what should happen next?".
 *
 * ```ts
 * plan(request)             → ConversationPlan
 * toDecisionHint(plan)      → DecisionHint | null   // Core's contract
 * ```
 *
 * Pure, total, clock-free, model-free and store-free. Identical input produces
 * byte-identical output, so a turn's reasoning can be replayed from its log and
 * "why did it ask instead of answering?" is answerable a year later.
 *
 * ## It decides how, never what
 *
 * Nothing this package produces contains a sentence anyone is meant to say. A
 * plan says *ask before acting*, *lead with the feeling*, *withhold advice*,
 * *say plainly that you are unsure*, *stay slow*. Generation writes the words.
 * The separation is the reason a decision engine exists at all: a component that
 * returned prose would have conflated what should happen with how to phrase it,
 * after which neither can be inspected, tested or overridden alone.
 *
 * ## Constraints are derived before options are weighed
 *
 * The load-bearing ordering. Safety and care requirements come from the
 * situation — and from identity's own autonomy principles and uncertainty bands
 * — *before* any strategy is considered, and then bind all of them. A blocked
 * strategy is not a low-scoring option; it is not an option. Folding the two
 * together would let a sufficiently strong preference for being helpful outvote
 * a requirement to ask first, which is the exact failure constraints exist to
 * prevent.
 *
 * ## Every option is weighed, and every argument is kept
 *
 * All eleven strategies are evaluated on every turn and all eleven evaluations
 * are returned — scores, signed considerations, and the constraints that ruled
 * any of them out. So "why not option B?" is answerable from the plan without
 * re-running anything, which a tree of conditionals could never do: a branch can
 * say what happened, not what nearly did.
 *
 * Ties break by `STRATEGY_PRIORITY`, ordered from most careful to most
 * assertive — "prefer asking over assuming" as a total order rather than as a
 * special case someone has to remember.
 *
 * ## It can only ever be more careful than personality proposed
 *
 * Initiative, pacing and depth reuse the expression vocabulary, and planning may
 * only move them *down*. Expression already composed what the relationship has
 * earned; a planner that could raise them would be substituting one turn's
 * reading for months of accumulated licence. That single rule is most of what
 * makes this feel like a companion rather than an autonomous agent.
 *
 * ## Horizons it does not yet reach
 *
 * `PlanHorizon` already admits `ongoing`, objectives are already plural, and an
 * in-progress `TaskPlan` is already an input. Multi-step projects,
 * reminders and proactive assistance arrive as new rules producing existing
 * shapes — not as a different engine.
 *
 * ## Where the vocabulary lives
 *
 * `ConversationPlan`, `Strategy`, `PlanConstraint` and the rest are in
 * `@nexa/models`. They have to be: `@nexa/core` may never import a capability
 * package, so anything Core or a sibling engine reads sits beneath both. This
 * package holds the rules, not their shapes.
 */

export type { PlanningRequest } from './plan.js';
export { plan } from './plan.js';

export { toDecisionHint, actFor } from './bridge.js';

export type { PlanningConfig } from './config.js';
export {
  DEFAULT_CONFIG,
  INITIATIVE_RANKS,
  DETAIL_RANKS,
  PACING_RANKS,
} from './config.js';

export type { Situation, Reading, SituationInputs } from './situation.js';
export { assess, DIFFICULT_FEELINGS } from './situation.js';

export type { DerivedConstraints } from './constraints.js';
export { deriveConstraints, stanceFor, planConfidence } from './constraints.js';

export type { StrategyPolicy } from './strategies.js';
export { STRATEGY_POLICIES, policyFor, blocksFor } from './strategies.js';

export type { Selection } from './select.js';
export { select, evaluate } from './select.js';

export type { Manner } from './compose.js';
export {
  mannerFor,
  objectivesFor,
  clarificationFor,
  followUpFor,
  memoryOpportunitiesFor,
  horizonFor,
} from './compose.js';
