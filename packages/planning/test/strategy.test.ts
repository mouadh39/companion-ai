import { describe, expect, it } from 'vitest';
import { STRATEGIES, STRATEGY_PRIORITY } from '@nexa/models';
import { DEFAULT_CONFIG, policyFor } from '@nexa/planning';
import {
  evaluationOf,
  expressionOf,
  flaggingBoundary,
  foundNothing,
  goalOf,
  identityOf,
  planFor,
  taskPlanOf,
  relationshipOf,
  retrieved,
  seen,
  turnOf,
} from './fixtures.js';

describe('the examples from the brief', () => {
  describe('"I\'m stuck."', () => {
    const result = planFor("I'm stuck.");

    it('does not answer straight away', () => {
      expect(result.strategy).not.toBe('answer_directly');
    });

    it('asks rather than assumes what is wrong', () => {
      // Nothing in "I'm stuck" says what they are stuck on. Explaining would be
      // answering a question nobody asked.
      expect(['clarify_first', 'explore_problem']).toContain(result.strategy);
    });

    it('weighed every option the brief names, and kept the arguments', () => {
      for (const strategy of [
        'clarify_first',
        'answer_directly',
        'encourage_then_explain',
        'explore_problem',
      ] as const) {
        const evaluation = evaluationOf(result, strategy);
        expect(evaluation, strategy).toBeDefined();
        expect(evaluation?.considerations.length).toBeGreaterThan(0);
      }
    });

    it('can say why it did not explain directly', () => {
      const rejected = evaluationOf(result, 'answer_directly');

      expect(rejected?.admissible === false || (rejected?.rank ?? 0) > 1).toBe(true);
    });
  });

  describe('"I\'m thinking of giving up."', () => {
    // A stated difficulty with prior progress to point back to.
    const result = planFor('I am so frustrated and exhausted, I am thinking of giving up.', {
      retrieval: retrieved(3, 0.7),
      conversation: [turnOf('user', 'I have been working on the shader for weeks.', -60)],
    });

    it('does not lead with advice', () => {
      expect(result.adviceStance).not.toBe('offer');
    });

    it('acknowledges the emotion rather than solving', () => {
      expect(['stay_with_them', 'acknowledge_first']).toContain(result.strategy);
      expect(['hold_space', 'lead_with_it']).toContain(result.emotionalHandling);
    });

    it('holds back advice because none was asked for', () => {
      expect(result.constraints).toContain('no_advice_unless_asked');
      expect(result.constraints).toContain('slow_down');
    });

    it('rules out answering directly rather than merely disfavouring it', () => {
      // A constraint that only lowered the score could be outvoted by a strong
      // enough preference for being useful.
      expect(evaluationOf(result, 'answer_directly')?.admissible).toBe(false);
    });

    it('keeps the previous progress as grounding', () => {
      expect(result.groundedIn.length).toBeGreaterThan(0);
    });

    it('recommends coming back to it', () => {
      expect(result.followUp?.kind).toBe('ask_how_it_went');
    });
  });
});

describe('strategy selection', () => {
  it('answers a clear, well-grounded question directly', () => {
    const result = planFor('How do I clear the shader cache?', { retrieval: retrieved(2, 0.8) });

    expect(result.strategy).toBe('answer_directly');
    expect(result.primaryObjective).toBe('answer_the_question');
  });

  it('teaches stepwise when the user is trying to understand', () => {
    const result = planFor('I want to understand how the scheduler works.', {
      retrieval: retrieved(2, 0.8),
    });

    expect(result.strategy).toBe('teach_stepwise');
    expect(result.primaryObjective).toBe('build_understanding');
  });

  it('explores when the user is thinking rather than asking', () => {
    const result = planFor('I have been thinking about restructuring the pipeline.', {
      retrieval: retrieved(2, 0.6),
    });

    expect(['explore_problem', 'offer_options']).toContain(result.strategy);
  });

  it('holds back when the user is closing', () => {
    const result = planFor('Right, good night.');

    expect(result.strategy).toBe('hold_back');
    expect(result.adviceStance).toBe('withhold');
  });

  it('holds back on silence', () => {
    const result = planFor('');

    expect(result.strategy).toBe('hold_back');
    expect(result.primaryObjective).toBe('hand_back_control');
  });

  it('reflects back after a correction', () => {
    const result = planFor("That's wrong, the port is 8080.", { retrieval: retrieved(1, 0.5) });

    expect(result.strategy).toBe('reflect_back');
    expect(result.constraints).toContain('defer_to_user_judgement');
  });

  it('encourages first when there is something real to encourage with', () => {
    // Requires both a difficulty and prior progress. Encouragement with nothing
    // behind it is flattery.
    const withProgress = planFor('I am frustrated, can you help me finish the shader?', {
      retrieval: retrieved(3, 0.8),
    });
    const without = planFor('I am frustrated, can you help me finish the shader?', {
      retrieval: foundNothing(),
    });

    expect(evaluationOf(withProgress, 'encourage_then_explain')?.score).toBeGreaterThan(
      evaluationOf(without, 'encourage_then_explain')?.score ?? 0,
    );
  });

  it('offers options rather than a recommendation on a constrained subject', () => {
    const result = planFor('What should I do about my medical situation?', {
      identity: identityOf(),
      retrieval: flaggingBoundary('medical'),
    });

    expect(['defer_to_user', 'offer_options', 'clarify_first']).toContain(result.strategy);
    expect(result.constraints).toContain('respect_stated_boundary');
  });
});

describe('every option is weighed and every argument kept', () => {
  const result = planFor('How do I clear the shader cache?', { retrieval: retrieved(2, 0.8) });

  it('evaluates all eleven strategies on every turn', () => {
    expect(result.considered).toHaveLength(STRATEGIES.length);
  });

  it('gives every evaluation at least one named argument', () => {
    for (const evaluation of result.considered) {
      expect(evaluation.considerations.length, evaluation.strategy).toBeGreaterThan(0);
    }
  });

  it('reports the losers in rank order with the blocked ones last', () => {
    const ranked = result.considered.filter((evaluation) => evaluation.rank !== null);
    const blocked = result.considered.filter((evaluation) => evaluation.rank === null);

    expect(ranked.map((evaluation) => evaluation.rank)).toStrictEqual(
      ranked.map((_, index) => index + 1),
    );
    expect(result.considered.slice(ranked.length)).toStrictEqual(blocked);
  });

  it('ranks the chosen strategy first', () => {
    expect(evaluationOf(result, result.strategy)?.rank).toBe(1);
  });

  it('names the runner-up in the rationale', () => {
    expect(result.rationale.some((reason) => reason.code === 'strategy_runner_up')).toBe(true);
  });

  it('never ranks an inadmissible strategy', () => {
    for (const evaluation of result.considered) {
      if (!evaluation.admissible) expect(evaluation.rank).toBeNull();
    }
  });
});

describe('ties resolve toward caution', () => {
  it('orders the priority table from least presuming to most', () => {
    expect(STRATEGY_PRIORITY.clarify_first).toBeLessThan(STRATEGY_PRIORITY.answer_directly);
    expect(STRATEGY_PRIORITY.stay_with_them).toBeLessThan(STRATEGY_PRIORITY.teach_stepwise);
    expect(STRATEGY_PRIORITY.defer_to_user).toBeLessThan(STRATEGY_PRIORITY.offer_options);
  });

  it('gives every strategy a distinct priority, so nothing can tie all the way down', () => {
    const ranks = STRATEGIES.map((strategy) => STRATEGY_PRIORITY[strategy]);
    expect(new Set(ranks).size).toBe(ranks.length);
  });

  it('falls to asking when nothing argues for anything', () => {
    // A planner that has run out of reasons should ask, not guess.
    const result = planFor('mm');

    expect(['clarify_first', 'hold_back']).toContain(result.strategy);
  });
});

describe('the strategy table is coherent', () => {
  it('leaves clarify_first blocked by nothing, so a plan is always possible', () => {
    expect(policyFor('clarify_first').blockedBy).toStrictEqual([]);
  });

  it('gives every strategy an objective and a stance', () => {
    for (const strategy of STRATEGIES) {
      const policy = policyFor(strategy);
      expect(policy.strategy).toBe(strategy);
      expect(policy.objective).toBeDefined();
      expect(policy.assertiveness).toBeGreaterThanOrEqual(0);
      expect(policy.assertiveness).toBeLessThanOrEqual(1);
    }
  });

  it('never lists a strategy’s primary objective among its secondary ones', () => {
    for (const strategy of STRATEGIES) {
      const policy = policyFor(strategy);
      expect(policy.alsoServes).not.toContain(policy.objective);
    }
  });

  it('makes the assertive strategies the constrained ones', () => {
    // The strategies that presume most are the ones safety must be able to
    // rule out. A blocked list on `hold_back` would be pointless.
    expect(policyFor('answer_directly').blockedBy.length).toBeGreaterThan(0);
    expect(policyFor('teach_stepwise').blockedBy.length).toBeGreaterThan(0);
    expect(policyFor('hold_back').blockedBy).toStrictEqual([]);
  });

  it('keeps the config table pointed at the strategy policies', () => {
    expect(DEFAULT_CONFIG.strategies.answer_directly).toBe(policyFor('answer_directly'));
  });
});

describe('goals and continuity', () => {
  it('reaches an ongoing horizon when a goal is in view', () => {
    const result = planFor('How do I clear the shader cache?', {
      goals: [goalOf('ship the Nexa demo')],
      retrieval: retrieved(2, 0.8),
    });

    expect(result.horizon).toBe('ongoing');
    expect(result.servingGoals.length).toBe(1);
  });

  it('does not react only to the latest message', () => {
    // The same message plans differently depending on what came before it.
    const cold = planFor('What now?');
    const warm = planFor('What now?', {
      plan: taskPlanOf(true),
      goals: [goalOf('ship the Nexa demo')],
      conversation: [turnOf('user', 'The shader still will not compile.', -5)],
    });

    expect(warm.horizon).not.toBe(cold.horizon);
    expect(warm.followUp).not.toBeNull();
  });

  it('recommends revisiting a blocked plan step', () => {
    const result = planFor('I am not sure what to do next.', {
      plan: taskPlanOf(true),
      goals: [goalOf('ship the Nexa demo')],
    });

    expect(result.followUp?.kind).toBe('revisit_goal');
    expect(result.secondaryObjectives).toContain('preserve_continuity');
  });

  it('carries relationship into the rationale', () => {
    const result = planFor('How do I clear the shader cache?', {
      relationship: relationshipOf({ sharedUnderstanding: 0.8 }),
      retrieval: retrieved(2, 0.8),
      expression: expressionOf(),
    });

    expect(result.rationale.some((reason) => reason.code === 'relationship_permits')).toBe(true);
  });

  it('notices what memory might want without writing anything', () => {
    const result = planFor("That's wrong, I prefer the shorter form.");

    expect(result.memoryOpportunities.length).toBeGreaterThan(0);
    expect(result.memoryOpportunities[0]?.suggestedSubject).toBeDefined();
  });
});

describe('perception feeds planning honestly', () => {
  it('treats a stated feeling differently from an inferred one', () => {
    // The observed/possible distinction, cashing out several layers from where
    // perception drew it.
    const stated = planFor('I am frustrated.');
    const implied = planFor('I guess nothing works.');

    expect(stated.emotionalHandling).not.toBe('do_not_presume');
    expect(implied.emotionalHandling).toBe('do_not_presume');
  });

  it('never presumes on an emotion nobody stated', () => {
    const implied = planFor('I guess nothing works.');

    expect(implied.constraints).toContain('avoid_overclaiming');
    expect(seen('I guess nothing works.').observations.some((o) => o.stance === 'observed')).toBe(
      true,
    );
  });
});
