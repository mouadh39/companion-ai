import type {
  AdviceStance,
  Consideration,
  EmotionalHandling,
  Objective,
  PlanConstraint,
  Strategy,
  StrategyBlock,
} from '@nexa/models';
import type { Situation } from './situation.js';

/**
 * Every strategy, what it is for, what forbids it, and what argues for it.
 *
 * One table, and it is the whole of the engine's judgement. Everything the
 * planner believes about when to ask rather than answer is here as data rather
 * than distributed through branches — which is what lets "why did it clarify
 * instead of explaining?" be answered by reading two rows instead of tracing a
 * function.
 *
 * ## Blocks are not weights
 *
 * Each strategy declares which constraints rule it out entirely. A blocked
 * strategy is never chosen however well it scores, and the block is reported.
 * That separation is what makes safety non-negotiable: `answer_directly` under
 * `require_clarification_before_acting` is not a low-scoring option, it is not
 * an option.
 *
 * ## Considerations are signed and named
 *
 * Scoring is a sum of named arguments rather than a formula over features. The
 * difference is that a losing strategy keeps its own list, so "why not option B?"
 * is answerable from the record without re-running anything. A weight here is a
 * claim about *how much this argues*, and it is legible next to the reason.
 */

export interface StrategyPolicy {
  readonly strategy: Strategy;

  /** Constraints that rule this out entirely. */
  readonly blockedBy: readonly PlanConstraint[];

  /** What choosing it is trying to achieve. */
  readonly objective: Objective;
  /** What it also achieves, when it does. */
  readonly alsoServes: readonly Objective[];

  readonly adviceStance: AdviceStance;
  readonly emotionalHandling: EmotionalHandling;

  /**
   * How much this strategy presumes, 0–1.
   *
   * Used to cap initiative: a plan that decided to stay with someone must not
   * also lead the conversation. Declared per strategy rather than derived,
   * because "how forward is this?" is a property of the shape of the turn and
   * not of the numbers that selected it.
   */
  readonly assertiveness: number;

  /** Weighs the situation. Pure, and reads nothing but the situation. */
  readonly weigh: (situation: Situation) => readonly Consideration[];
}

const argue = (
  code: Consideration['code'],
  weight: number,
  detail: string,
): Consideration => ({ code, weight, detail });

/**
 * The baseline every strategy starts from.
 *
 * Small and negative for the assertive strategies, so that in a situation with
 * no signal at all the careful ones win. A companion with nothing to go on
 * should ask, not answer — and encoding that as a starting position rather than
 * as a special case means it holds for every combination of inputs rather than
 * for the ones somebody remembered to handle.
 */
const BASE: Readonly<Record<Strategy, number>> = {
  clarify_first: 0.2,
  acknowledge_first: 0,
  stay_with_them: 0,
  explore_problem: 0,
  encourage_then_explain: -0.1,
  answer_directly: -0.1,
  teach_stepwise: -0.2,
  offer_options: -0.2,
  reflect_back: -0.1,
  defer_to_user: -0.1,
  hold_back: -0.3,
};

export const STRATEGY_POLICIES: Readonly<Record<Strategy, StrategyPolicy>> = {
  /**
   * Ask before proceeding.
   *
   * The strategy the engine falls toward, by construction. It is blocked by
   * nothing, starts from a positive base, and gains from every kind of doubt —
   * so a planner that has run out of reasons ends up asking rather than guessing.
   */
  clarify_first: {
    strategy: 'clarify_first',
    blockedBy: [],
    objective: 'understand_the_request',
    alsoServes: ['confirm_understanding'],
    adviceStance: 'on_request',
    emotionalHandling: 'acknowledge_briefly',
    assertiveness: 0.2,
    weigh: (s) => {
      const out = [argue('intent_unclear', BASE.clarify_first, 'Baseline: asking presumes least.')];
      if (s.clarity < 0.5) {
        out.push(argue('intent_unclear', 0.6, `Clarity is only ${s.clarity.toFixed(2)}.`));
      }
      if (s.conflicted) out.push(argue('intent_unclear', 0.3, 'Readings disagree with each other.'));
      if (s.ungrounded && s.asked) {
        out.push(argue('intent_unclear', 0.2, 'A question was asked and nothing relevant was found.'));
      }
      if (s.silent) out.push(argue('nothing_to_add', -0.8, 'There is nothing to ask about.'));
      if (s.closing) out.push(argue('user_is_closing', -0.5, 'The user is ending the exchange.'));
      if (s.asked && s.clarity >= 0.7 && s.wellGrounded) {
        out.push(argue('intent_clear', -0.5, 'A clear question with something to answer it from.'));
      }
      return out;
    },
  },

  /** Respond to the feeling before the content. */
  acknowledge_first: {
    strategy: 'acknowledge_first',
    blockedBy: [],
    objective: 'support_the_user',
    alsoServes: ['preserve_continuity'],
    adviceStance: 'on_request',
    emotionalHandling: 'lead_with_it',
    assertiveness: 0.3,
    weigh: (s) => {
      const out = [argue('emotion_observed', BASE.acknowledge_first, 'Baseline.')];
      if (s.statedFeeling !== null) {
        out.push(
          argue(
            'emotion_observed',
            0.5 + 0.2 * s.statedFeeling.magnitude,
            `The user said they feel '${s.statedFeeling.dimension}'.`,
          ),
        );
      }
      // An inferred feeling argues far more weakly than a stated one, and this
      // gap is the whole reason perception's stance is carried this far down. A
      // companion that responds to moods it guessed at will eventually console
      // someone who was perfectly cheerful.
      if (s.statedFeeling === null && s.strongestFeeling !== null) {
        out.push(
          argue(
            'emotion_possible_only',
            0.15,
            `'${s.strongestFeeling.dimension}' was inferred, not stated.`,
          ),
        );
      }
      if (s.askedForHelp && s.statedFeeling === null) {
        out.push(argue('user_asked_for_help', -0.3, 'Help was asked for and no feeling was stated.'));
      }
      if (s.silent) out.push(argue('nothing_to_add', -0.8, 'Nothing was said.'));
      return out;
    },
  },

  /**
   * Be present without advising.
   *
   * The strategy for "I'm thinking of giving up" — where the useful turn is not
   * a better suggestion. It requires a *stated* difficult feeling: inferring
   * that someone needs to be sat with, and then sitting with them, is a way of
   * being wrong that is hard for the user to correct.
   */
  stay_with_them: {
    strategy: 'stay_with_them',
    blockedBy: [],
    objective: 'support_the_user',
    alsoServes: ['hand_back_control'],
    adviceStance: 'withhold',
    emotionalHandling: 'hold_space',
    assertiveness: 0.1,
    weigh: (s) => {
      const out = [argue('emotion_observed', BASE.stay_with_them, 'Baseline.')];
      const stated = s.statedFeeling;

      if (stated !== null && s.distressed) {
        out.push(
          argue(
            'emotion_observed',
            0.5 + 0.3 * stated.magnitude,
            `A difficult feeling was stated at magnitude ${stated.magnitude.toFixed(2)}.`,
          ),
        );
      }
      if (s.askedForHelp) {
        // Someone who asked for help wants help. Withholding it to sit with them
        // is a way of not listening that feels like care.
        out.push(argue('user_asked_for_help', -0.6, 'Help was explicitly asked for.'));
      }
      if (s.asked) out.push(argue('intent_clear', -0.3, 'A question was asked.'));
      if (stated === null) {
        out.push(argue('emotion_possible_only', -0.5, 'No feeling was stated outright.'));
      }
      if (s.silent) out.push(argue('nothing_to_add', -0.8, 'Nothing was said.'));
      return out;
    },
  },

  /** Draw the problem out rather than guessing at it. */
  explore_problem: {
    strategy: 'explore_problem',
    blockedBy: [],
    objective: 'explore_together',
    alsoServes: ['unblock_the_user', 'understand_the_request'],
    adviceStance: 'on_request',
    emotionalHandling: 'acknowledge_briefly',
    assertiveness: 0.4,
    weigh: (s) => {
      const out = [argue('user_is_exploring', BASE.explore_problem, 'Baseline.')];
      if (s.exploring) out.push(argue('user_is_exploring', 0.5, 'The user is working something out.'));
      if (s.planBlocked) out.push(argue('goal_served', 0.3, 'A plan step cannot proceed.'));
      if (s.clarity >= 0.4 && s.clarity < 0.7) {
        out.push(argue('intent_unclear', 0.25, 'The purpose is legible but not sharp.'));
      }
      if (s.ungrounded) out.push(argue('memory_supported', 0.2, 'Nothing was retrieved to explain from.'));
      if (s.closing) out.push(argue('user_is_closing', -0.6, 'The user is ending the exchange.'));
      if (s.silent) out.push(argue('nothing_to_add', -0.8, 'Nothing was said.'));
      return out;
    },
  },

  /**
   * Affirm what is working, then help.
   *
   * Requires something real to affirm. Encouragement with nothing behind it is
   * flattery, and a companion that produces it on schedule is one whose warmth
   * stops meaning anything — so this needs both a difficulty and a retrieved
   * memory of prior progress.
   */
  encourage_then_explain: {
    strategy: 'encourage_then_explain',
    blockedBy: ['no_advice_unless_asked'],
    objective: 'unblock_the_user',
    alsoServes: ['support_the_user', 'preserve_continuity'],
    adviceStance: 'offer',
    emotionalHandling: 'acknowledge_briefly',
    assertiveness: 0.6,
    weigh: (s) => {
      const out = [argue('memory_supported', BASE.encourage_then_explain, 'Baseline.')];
      if (s.distressed && s.wellGrounded) {
        out.push(
          argue('memory_supported', 0.5, 'There is a difficulty and something concrete to point back to.'),
        );
      }
      if (s.distressed && !s.wellGrounded) {
        out.push(argue('memory_supported', -0.4, 'Nothing retrieved to encourage *with*.'));
      }
      if (s.askedForHelp) out.push(argue('user_asked_for_help', 0.3, 'Help was asked for.'));
      if (s.planInProgress) out.push(argue('continuity_preserved', 0.2, 'A plan is already under way.'));
      if (s.silent) out.push(argue('nothing_to_add', -0.8, 'Nothing was said.'));
      return out;
    },
  },

  /** Answer or explain now. */
  answer_directly: {
    strategy: 'answer_directly',
    blockedBy: [
      'require_clarification_before_acting',
      'no_advice_unless_asked',
      'respect_stated_boundary',
    ],
    objective: 'answer_the_question',
    alsoServes: ['unblock_the_user'],
    adviceStance: 'offer',
    emotionalHandling: 'none',
    assertiveness: 0.8,
    weigh: (s) => {
      const out = [argue('intent_clear', BASE.answer_directly, 'Baseline.')];
      if (s.asked && s.clarity >= 0.7) {
        out.push(argue('intent_clear', 0.6, `A clear question, clarity ${s.clarity.toFixed(2)}.`));
      }
      if (s.askedForHelp && s.clarity >= 0.6) {
        out.push(argue('user_asked_for_help', 0.4, 'Help was asked for and the ask is legible.'));
      }
      if (s.wellGrounded) out.push(argue('memory_supported', 0.3, 'Retrieval found something squarely relevant.'));
      if (s.urgent) out.push(argue('user_asked_for_help', 0.25, 'Urgency was read; get to the point.'));
      if (s.distressed && s.statedFeeling !== null) {
        out.push(argue('emotion_observed', -0.35, 'A difficult feeling was stated; leading with content is cold.'));
      }
      if (s.exploring) out.push(argue('user_is_exploring', -0.3, 'The user is thinking, not asking.'));
      if (s.silent) out.push(argue('nothing_to_add', -0.9, 'Nothing was said.'));
      return out;
    },
  },

  /** Break it down and check understanding as you go. */
  teach_stepwise: {
    strategy: 'teach_stepwise',
    blockedBy: ['require_clarification_before_acting', 'respect_stated_boundary'],
    objective: 'build_understanding',
    alsoServes: ['unblock_the_user'],
    adviceStance: 'offer',
    emotionalHandling: 'none',
    assertiveness: 0.7,
    weigh: (s) => {
      const out = [argue('user_is_learning', BASE.teach_stepwise, 'Baseline.')];
      if (s.learning) out.push(argue('user_is_learning', 0.6, 'The user is trying to understand.'));
      if (s.learning && s.clarity >= 0.6) {
        out.push(argue('intent_clear', 0.2, 'And the ask is legible.'));
      }
      if (s.urgent) out.push(argue('user_asked_for_help', -0.4, 'Urgency and stepwise teaching do not mix.'));
      if (s.silent) out.push(argue('nothing_to_add', -0.9, 'Nothing was said.'));
      return out;
    },
  },

  /**
   * Present alternatives rather than one recommendation.
   *
   * For when the choice is genuinely the user's — several viable routes, or a
   * subject where the companion should not be picking. It is how "help the user
   * reach their own goal rather than taking control" looks as a turn.
   */
  offer_options: {
    strategy: 'offer_options',
    blockedBy: ['require_clarification_before_acting'],
    objective: 'hand_back_control',
    alsoServes: ['unblock_the_user', 'explore_together'],
    adviceStance: 'offer',
    emotionalHandling: 'none',
    assertiveness: 0.5,
    weigh: (s) => {
      const out = [argue('user_is_exploring', BASE.offer_options, 'Baseline.')];
      if (s.exploring) out.push(argue('user_is_exploring', 0.45, 'The user is weighing something up.'));
      if (s.identityBoundary !== null) {
        out.push(argue('identity_boundary', 0.4, 'A constrained subject; the choice is the user’s.'));
      }
      if (s.userHedged) out.push(argue('intent_unclear', 0.2, 'The user is not committed to a direction.'));
      if (s.urgent) out.push(argue('user_asked_for_help', -0.3, 'Urgency wants one route, not several.'));
      if (s.silent) out.push(argue('nothing_to_add', -0.9, 'Nothing was said.'));
      return out;
    },
  },

  /** Say back what was understood, to confirm it. */
  reflect_back: {
    strategy: 'reflect_back',
    blockedBy: [],
    objective: 'confirm_understanding',
    alsoServes: ['preserve_continuity'],
    adviceStance: 'on_request',
    emotionalHandling: 'acknowledge_briefly',
    assertiveness: 0.3,
    weigh: (s) => {
      const out = [argue('continuity_preserved', BASE.reflect_back, 'Baseline.')];
      if (s.corrected) {
        out.push(argue('intent_clear', 0.5, 'The companion was corrected; check the new understanding.'));
      }
      if (s.disagreed) out.push(argue('intent_clear', 0.3, 'The user disagreed.'));
      if (s.conflicted) out.push(argue('intent_unclear', 0.25, 'Readings disagree; confirm rather than proceed.'));
      if (s.exploring && s.sharedUnderstanding < 0.4) {
        out.push(argue('relationship_restrains', 0.2, 'Little shared understanding to rely on yet.'));
      }
      if (s.silent) out.push(argue('nothing_to_add', -0.8, 'Nothing was said.'));
      return out;
    },
  },

  /** Hand the choice over. */
  defer_to_user: {
    strategy: 'defer_to_user',
    blockedBy: [],
    objective: 'hand_back_control',
    alsoServes: [],
    adviceStance: 'on_request',
    emotionalHandling: 'acknowledge_briefly',
    assertiveness: 0.1,
    weigh: (s) => {
      const out = [argue('relationship_restrains', BASE.defer_to_user, 'Baseline.')];
      if (s.identityBoundary !== null) {
        out.push(argue('identity_boundary', 0.55, 'Identity constrains this subject.'));
      }
      if (s.boundaries.length > 0) {
        out.push(argue('relationship_restrains', 0.3, 'The relationship records a boundary.'));
      }
      if (s.corrected) out.push(argue('intent_clear', 0.2, 'The user knows something the companion did not.'));
      if (s.asked && s.identityBoundary === null) {
        out.push(argue('intent_clear', -0.35, 'A question was asked; deferring dodges it.'));
      }
      if (s.silent) out.push(argue('nothing_to_add', -0.6, 'Nothing was said.'));
      return out;
    },
  },

  /**
   * Say little.
   *
   * The only strategy that wins on silence, and it needs to exist for the same
   * reason `stay_silent` exists in Core: a companion with no reflex to say
   * nothing will fill every pause, and filling pauses is how presence becomes
   * pestering.
   */
  hold_back: {
    strategy: 'hold_back',
    blockedBy: [],
    objective: 'hand_back_control',
    alsoServes: [],
    adviceStance: 'withhold',
    emotionalHandling: 'none',
    assertiveness: 0,
    weigh: (s) => {
      const out = [argue('nothing_to_add', BASE.hold_back, 'Baseline.')];
      if (s.silent) out.push(argue('nothing_to_add', 1.2, 'Nothing was said; there is nothing to answer.'));
      if (s.closing) out.push(argue('user_is_closing', 0.7, 'The user is ending the exchange.'));
      if (s.asked) out.push(argue('intent_clear', -0.6, 'A question was asked.'));
      if (s.askedForHelp) out.push(argue('user_asked_for_help', -0.6, 'Help was asked for.'));
      return out;
    },
  },
};

export const policyFor = (strategy: Strategy): StrategyPolicy => STRATEGY_POLICIES[strategy];

/** Constraints that rule a strategy out, given what was derived. */
export const blocksFor = (
  strategy: Strategy,
  constraints: readonly PlanConstraint[],
): readonly StrategyBlock[] =>
  policyFor(strategy)
    .blockedBy.filter((constraint) => constraints.includes(constraint))
    .map((constraint) => ({
      constraint,
      detail: `'${strategy}' is ruled out by '${constraint}'.`,
    }));
