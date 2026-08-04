import { describe, expect, it } from 'vitest';
import { PLAN_CONSTRAINTS } from '@nexa/models';
import { DEFAULT_CONFIG, planConfidence, stanceFor } from '@nexa/planning';
import {
  evaluationOf,
  expressionOf,
  flaggingBoundary,
  foundNothing,
  identityOf,
  inferredOnly,
  planFor,
  relationshipOf,
  retrieved,
} from './fixtures.js';

describe('constraints bind rather than compete', () => {
  it('rules a strategy out entirely, whatever it scored', () => {
    const result = planFor('I am so frustrated and exhausted.');

    const blocked = evaluationOf(result, 'answer_directly');
    expect(blocked?.admissible).toBe(false);
    expect(blocked?.rank).toBeNull();
    expect(blocked?.blockedBy.map((entry) => entry.constraint)).toContain(
      'no_advice_unless_asked',
    );
  });

  it('never chooses a blocked strategy however the numbers fall', () => {
    const result = planFor('I am so frustrated and exhausted.');
    const chosen = evaluationOf(result, result.strategy);

    expect(chosen?.admissible).toBe(true);
  });

  it('reports every block in the rationale', () => {
    const result = planFor('I am so frustrated and exhausted.');

    expect(result.rationale.some((reason) => reason.code === 'strategy_blocked')).toBe(true);
  });

  it('returns constraints in a stable order', () => {
    // Two runs of the same situation must produce the same list, whatever order
    // the rules fired in.
    const a = planFor('I am so frustrated and exhausted.').constraints;
    const b = planFor('I am so frustrated and exhausted.').constraints;

    expect(b).toStrictEqual(a);
    expect([...a]).toStrictEqual([...a].sort());
  });

  it('only ever names real constraints', () => {
    const result = planFor('I am so frustrated, can you help?');

    for (const constraint of result.constraints) {
      expect(PLAN_CONSTRAINTS).toContain(constraint);
    }
  });
});

describe('asking rather than assuming', () => {
  it('requires clarification when the reading is unclear', () => {
    const result = planFor('mm');

    expect(result.constraints).toContain('require_clarification_before_acting');
    expect(result.clarification?.reason).toBe('intent_unclear');
    expect(result.clarification?.blocking).toBe(true);
  });

  it('requires it when perception found readings that disagree', () => {
    const result = planFor("Yes, exactly — but I don't think that works.");

    expect(result.constraints).toContain('require_clarification_before_acting');
    expect(result.clarification?.reason).toBe('conflicting_signals');
  });

  it('honours an identity autonomy principle that resolves by asking', () => {
    const result = planFor('How do I clear the shader cache?', {
      identity: identityOf(),
      retrieval: retrieved(2, 0.8),
    });

    expect(result.constraints).toContain('require_clarification_before_acting');
  });

  it('carries the reason and never the question', () => {
    // Writing the question is generation's job. A plan holding a sentence would
    // have started doing generation's work.
    const result = planFor('mm');

    expect(result.clarification?.detail).toBeDefined();
    expect(JSON.stringify(result)).not.toMatch(/\?/u);
  });

  it('notes missing context without blocking on it', () => {
    const result = planFor('How do I clear the shader cache?', { retrieval: foundNothing() });

    expect(result.clarification?.reason).toBe('missing_context');
    expect(result.clarification?.blocking).toBe(false);
  });
});

describe('uncertainty comes from identity', () => {
  it('reads the band from the profile rather than from a local threshold', () => {
    const identity = identityOf();

    expect(stanceFor(identity, 0.9).band).toBe('confident');
    expect(stanceFor(identity, 0.6).band).toBe('tentative');
    expect(stanceFor(identity, 0.3).band).toBe('unsure');
    expect(stanceFor(identity, 0.3).defer).toBe(true);
  });

  it('discloses when identity says to', () => {
    const result = planFor('mm', { identity: identityOf() });

    expect(result.uncertainty.disclose).toBe(true);
    expect(result.constraints).toContain('disclose_uncertainty');
  });

  it('stays careful when no identity was supplied', () => {
    // A companion missing its own definition should not become more assertive
    // for the lack of it.
    expect(stanceFor(null, 0.3).disclose).toBe(true);
    expect(stanceFor(null, 0.3).defer).toBe(true);
    expect(stanceFor(null, 0.3).band).toBe('unknown');
  });

  it('is total over an identity with no bands declared', () => {
    const empty = identityOf({ uncertainty: [] });
    expect(() => stanceFor(empty, 0.5)).not.toThrow();
  });

  it('lowers plan confidence when nothing was retrieved', () => {
    const grounded = planFor('How do I clear the shader cache?', { retrieval: retrieved(2, 0.8) });
    const ungrounded = planFor('How do I clear the shader cache?', { retrieval: foundNothing() });

    expect(ungrounded.uncertainty.confidence).toBeLessThan(grounded.uncertainty.confidence);
  });

  it('separates confidence in the reading from confidence in an answer', () => {
    // The clearest possible question about something unknown is read perfectly
    // and answered badly, and only the second is a reason to hedge content.
    const result = planFor('How do I clear the shader cache?', { retrieval: foundNothing() });

    expect(result.uncertainty.confidence).toBeGreaterThan(0);
    expect(result.constraints).toContain('avoid_overclaiming');
  });
});

describe('never encouraging overclaim', () => {
  it('hedges everything when the only support is inferred', () => {
    const result = planFor('Do I usually work late?', { retrieval: inferredOnly(2) });

    expect(result.constraints).toContain('do_not_assert_from_inference');
    expect(result.constraints).toContain('avoid_overclaiming');
    expect(result.informedBy.length).toBeGreaterThan(0);
    expect(result.groundedIn).toStrictEqual([]);
  });

  it('does not hedge when something the user said is in play', () => {
    const result = planFor('Do I usually work late?', { retrieval: retrieved(2, 0.8) });

    expect(result.constraints).not.toContain('do_not_assert_from_inference');
  });

  it('becomes careful after being corrected', () => {
    const result = planFor("That's wrong, the port is 8080.");

    expect(result.constraints).toContain('avoid_overclaiming');
    expect(result.constraints).toContain('defer_to_user_judgement');
  });

  it('respects a boundary rather than answering through it', () => {
    const result = planFor('What should I do about this?', {
      identity: identityOf(),
      retrieval: flaggingBoundary('medical'),
    });

    expect(result.constraints).toContain('respect_stated_boundary');
    expect(evaluationOf(result, 'answer_directly')?.admissible).toBe(false);
  });

  it('respects a boundary the relationship recorded', () => {
    const result = planFor('How do I clear the shader cache?', {
      relationship: relationshipOf({ boundaries: ['no work talk after seven'] }),
      retrieval: retrieved(2, 0.8),
    });

    expect(result.constraints).toContain('respect_stated_boundary');
  });
});

describe('slowing down and simplifying', () => {
  it('slows down when a difficult feeling was read', () => {
    const result = planFor('I am exhausted.', { expression: expressionOf() });

    expect(result.constraints).toContain('slow_down');
    expect(result.pacing).toBe('slow');
  });

  it('simplifies under urgency', () => {
    const result = planFor('I need this fixed asap, the deadline is today.', {
      expression: expressionOf({ detail: 'thorough' }),
    });

    expect(result.constraints).toContain('simplify');
    expect(result.explanationDepth).toBe('brief');
  });

  it('withholds advice from someone who did not ask for it', () => {
    const unasked = planFor('I am exhausted.');
    const asked = planFor('I am exhausted, can you help me finish this?');

    expect(unasked.constraints).toContain('no_advice_unless_asked');
    expect(asked.constraints).not.toContain('no_advice_unless_asked');
  });
});

describe('planning is never more forward than personality proposed', () => {
  it('caps initiative at the configured ceiling', () => {
    const result = planFor('How do I clear the shader cache?', {
      expression: expressionOf({ initiative: 'lead' }),
      retrieval: retrieved(2, 0.8),
    });

    expect(result.initiative).not.toBe('lead');
    expect(DEFAULT_CONFIG.maxInitiative).toBe('offer');
  });

  it('never raises what expression proposed', () => {
    const result = planFor('How do I clear the shader cache?', {
      expression: expressionOf({ initiative: 'follow', pacing: 'slow', detail: 'minimal' }),
      retrieval: retrieved(2, 0.8),
    });

    expect(result.initiative).toBe('follow');
    expect(result.pacing).toBe('slow');
    expect(result.explanationDepth).toBe('minimal');
  });

  it('starts from the middle when no expression was composed', () => {
    // An absent personality is not permission to be forward.
    const result = planFor('How do I clear the shader cache?', { retrieval: retrieved(2, 0.8) });

    expect(result.initiative).not.toBe('lead');
  });

  it('lowers initiative further when deferring to the user', () => {
    const result = planFor("That's wrong, the port is 8080.", {
      expression: expressionOf({ initiative: 'lead' }),
    });

    expect(result.initiative).toBe('follow');
  });

  it('records that it capped anything', () => {
    const result = planFor('I am exhausted.', { expression: expressionOf() });

    expect(result.rationale.some((reason) => reason.code === 'expression_capped')).toBe(true);
  });

  it('keeps a withholding strategy from leading the conversation', () => {
    const result = planFor('I am so frustrated and exhausted.', {
      expression: expressionOf({ initiative: 'lead' }),
    });

    expect(result.initiative).toBe('follow');
  });
});

describe('plan confidence', () => {
  it('is zero on silence', () => {
    const result = planFor('');
    expect(result.uncertainty.confidence).toBe(0);
  });

  it('never leaves the unit range, for any shape of message', () => {
    // Exercised through real plans rather than a hand-built situation, so the
    // inputs are ones the upstream engines can actually produce.
    const messages = [
      '',
      'mm',
      'How do I fix this?',
      'I am so frustrated!!',
      "Yes, exactly — but I don't think that works.",
      'Right, good night.',
    ];

    for (const message of messages) {
      for (const retrieval of [null, foundNothing(), inferredOnly(2), retrieved(3, 0.9)]) {
        const value = planFor(message, { retrieval, identity: identityOf() }).uncertainty
          .confidence;
        expect(value, `${message} / ${String(retrieval?.items.length)}`).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
    }
  });

  it('is exposed for a caller that wants the number without a plan', () => {
    const result = planFor('How do I clear the shader cache?', { retrieval: retrieved(2, 0.9) });

    expect(planConfidence).toBeTypeOf('function');
    expect(result.uncertainty.confidence).toBeGreaterThan(0);
  });
});
