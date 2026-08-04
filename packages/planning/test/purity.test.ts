import { describe, expect, it } from 'vitest';
import { MIN_ACTIONABLE_HINT_CONFIDENCE, STRATEGIES } from '@nexa/models';
import { actFor, plan, toDecisionHint } from '@nexa/planning';
import type { PlanningRequest } from '@nexa/planning';
import {
  at,
  expressionOf,
  goalOf,
  identityOf,
  planFor,
  taskPlanOf,
  relationshipOf,
  retrieved,
  seen,
  turnOf,
} from './fixtures.js';

const world = (): PlanningRequest => ({
  at: at(0),
  perception: seen('I am frustrated with the shader — can you help me plan a fix?', [
    turnOf('user', 'The shader compiler keeps failing on Android.', -6),
    turnOf('companion', 'That is usually a precision qualifier problem.', -5),
  ]),
  retrieval: retrieved(3, 0.7),
  conversation: [
    turnOf('user', 'The shader compiler keeps failing on Android.', -6),
    turnOf('companion', 'That is usually a precision qualifier problem.', -5),
  ],
  goals: [goalOf('ship the Nexa demo'), goalOf('learn Spanish', 0.3)],
  relationship: relationshipOf(),
  expression: expressionOf(),
  identity: identityOf(),
  plan: taskPlanOf(),
});

describe('purity', () => {
  it('never mutates what it was given', () => {
    const request = world();
    const snapshot = structuredClone({
      perception: request.perception,
      retrieval: request.retrieval,
      conversation: request.conversation,
      goals: request.goals,
      relationship: request.relationship,
      expression: request.expression,
      plan: request.plan,
    });

    plan(request);

    expect({
      perception: request.perception,
      retrieval: request.retrieval,
      conversation: request.conversation,
      goals: request.goals,
      relationship: request.relationship,
      expression: request.expression,
      plan: request.plan,
    }).toStrictEqual(snapshot);
  });

  it('returns a deeply equal result for the same request', () => {
    expect(plan(world())).toStrictEqual(plan(world()));
  });

  it('reads no clock — the instant comes from the argument', () => {
    expect(plan({ ...world(), at: at(500) }).at).toBe(at(500));
  });

  it('produces the same strategy and the same scores across runs', () => {
    const a = plan(world());
    const b = plan(world());

    expect(b.strategy).toBe(a.strategy);
    expect(b.considered.map((entry) => [entry.strategy, entry.score, entry.rank])).toStrictEqual(
      a.considered.map((entry) => [entry.strategy, entry.score, entry.rank]),
    );
  });

  it('does not depend on the order goals arrived in', () => {
    const request = world();
    const forwards = plan(request);
    const backwards = plan({ ...request, goals: [...(request.goals ?? [])].reverse() });

    expect(backwards.strategy).toBe(forwards.strategy);
    expect(backwards.constraints).toStrictEqual(forwards.constraints);
  });

  it('generates no text anyone is meant to say', () => {
    // The line this whole package is drawn around. Every string in a plan is an
    // explanation for a developer or a reference — never a sentence for a user.
    const result = plan(world());

    expect(result).not.toHaveProperty('message');
    expect(result).not.toHaveProperty('response');
    expect(result).not.toHaveProperty('prompt');
    expect(result).not.toHaveProperty('text');
  });
});

describe('replay', () => {
  it('reconstructs the same plan from a serialised request', () => {
    const request = world();
    const round = JSON.parse(JSON.stringify(request)) as PlanningRequest;

    expect(plan(round)).toStrictEqual(plan(request));
  });

  it('is unaffected by when the replay itself runs', () => {
    const once = plan(world());
    const again = plan(world());

    expect(again.rationale).toStrictEqual(once.rationale);
  });
});

describe('totality', () => {
  const bare: PlanningRequest = { at: at(0), perception: seen('hello') };

  it('plans with nothing but a perception', () => {
    const result = plan(bare);

    expect(result.strategy).toBeDefined();
    expect(result.considered).toHaveLength(STRATEGIES.length);
  });

  it('plans on silence without throwing', () => {
    expect(() => plan({ at: at(0), perception: seen('') })).not.toThrow();
  });

  it('always produces at least one admissible strategy', () => {
    // `clarify_first` is blocked by nothing, so the planner can never be left
    // with nothing to do. Asking is never the wrong thing to be left with.
    for (const message of ['', 'mm', 'hello', 'I am exhausted.', "That's wrong."]) {
      const result = planFor(message, { identity: identityOf() });
      expect(result.considered.some((entry) => entry.admissible)).toBe(true);
    }
  });

  it('tells retrieval not running from retrieval finding nothing', () => {
    // A capability that is absent and a fact about the conversation are
    // different things, and only the second should make the companion careful.
    const notRun = planFor('How do I clear the shader cache?');
    const ranEmpty = planFor('How do I clear the shader cache?', {
      retrieval: { ...retrieved(0), consideredCount: 8 },
    });

    expect(notRun.constraints).not.toContain('avoid_overclaiming');
    expect(ranEmpty.constraints).toContain('avoid_overclaiming');
  });

  it('handles an identity with no boundaries or principles', () => {
    const bland = identityOf({ autonomy: [], knowledgeBoundaries: [] });
    const result = planFor('How do I clear the shader cache?', {
      identity: bland,
      retrieval: retrieved(2, 0.8),
    });

    expect(result.constraints).not.toContain('respect_stated_boundary');
    expect(result.strategy).toBe('answer_directly');
  });

  it('caps secondary objectives', () => {
    const result = plan(world());
    expect(result.secondaryObjectives.length).toBeLessThanOrEqual(3);
  });

  it('never lists the primary objective among the secondary ones', () => {
    for (const message of ['hello', 'I am exhausted.', 'How do I fix this?', '']) {
      const result = planFor(message);
      expect(result.secondaryObjectives).not.toContain(result.primaryObjective);
    }
  });
});

describe('the bridge to Core', () => {
  it('projects a confident plan to a hint Core can act on', () => {
    const result = planFor('How do I clear the shader cache?', { retrieval: retrieved(2, 0.9) });
    const hint = toDecisionHint(result);

    expect(hint).not.toBeNull();
    expect(hint?.suggested).toBe('answer');
    expect(hint?.source).toBe('nexa/planning');
  });

  it('declines to advise below the threshold Core would ignore anyway', () => {
    // Filtering here means the absence is legible at the point it was decided.
    const result = planFor('mm');

    expect(result.uncertainty.confidence).toBeLessThan(MIN_ACTIONABLE_HINT_CONFIDENCE);
    expect(toDecisionHint(result)).toBeNull();
  });

  it('never suggests silence, whatever the plan chose', () => {
    // An advisor that can silence the companion can make it unresponsive
    // through one bad upstream call.
    for (const strategy of STRATEGIES) {
      expect(actFor(strategy)).not.toBe('stay_silent');
    }
  });

  it('maps every strategy to a real act', () => {
    for (const strategy of STRATEGIES) {
      expect(actFor(strategy)).toBeDefined();
    }
  });

  it('collapses the asking strategies onto one act while the plan keeps the distinction', () => {
    expect(actFor('clarify_first')).toBe('ask_clarifying_question');
    expect(actFor('explore_problem')).toBe('ask_clarifying_question');
    expect(actFor('reflect_back')).toBe('ask_clarifying_question');

    const result = planFor("I'm stuck.");
    expect(result.strategy).not.toBe(actFor(result.strategy));
  });

  it('carries reasons Core understands, in a stable order', () => {
    const result = planFor('How do I clear the shader cache?', { retrieval: retrieved(2, 0.9) });
    const hint = toDecisionHint(result);

    expect(hint?.reasonCodes.length).toBeGreaterThan(0);
    expect([...(hint?.reasonCodes ?? [])]).toStrictEqual([...(hint?.reasonCodes ?? [])].sort());
    expect(toDecisionHint(result)).toStrictEqual(hint);
  });

  it('lets the caller name the source', () => {
    const result = planFor('How do I clear the shader cache?', { retrieval: retrieved(2, 0.9) });

    expect(toDecisionHint(result, 'nexa/planning@2')?.source).toBe('nexa/planning@2');
  });
});
