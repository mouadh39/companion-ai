import { describe, expect, it } from 'vitest';
import {
  ContributorCycleError,
  Deadline,
  UnknownContributorError,
  contributorKey,
  planWaves,
  runContributions,
} from '@nexa/core';
import type { AnyContribution, ContributionRequest, PortOptions } from '@nexa/core';
import { confidence } from '@nexa/models';
import { FixedClock, systemClock, trustExternalId } from '@nexa/shared';
import type { CompanionId, TurnId, UserId } from '@nexa/shared';

/**
 * The contributor graph, held to the properties that justify it existing.
 *
 * The hand-written two-phase fan-out it replaces was correct. What it could not
 * do was tell you it was correct: an edge lived in the order of two statements,
 * so a contributor added to the wrong phase read an empty dependency and
 * nothing failed. These tests are the check that could not be written before.
 */

const turnId = trustExternalId<TurnId>('00000000-0000-7000-8000-0000000000bb');

const request: ContributionRequest = {
  clientCapabilities: null,
  turnId,
  companionId: trustExternalId<CompanionId>('companion-1'),
  userId: trustExternalId<UserId>('user-1'),
  perception: {
    text: 'hello',
    intents: [{ kind: 'casual', confidence: confidence(0.9) }],
    entities: [],
    emotion: null,
  },
};

const options = (budgetMs = 1_000): PortOptions => ({
  signal: new AbortController().signal,
  deadline: Deadline.after(systemClock, budgetMs),
  turnId,
});

const A = contributorKey<string>('a', 'goals');
const B = contributorKey<string>('b', 'world');
const C = contributorKey<string>('c', 'retrieved_memories');

/** A contributor that succeeds with a fixed value, recording when it ran. */
const producing = (
  key: typeof A,
  value: string,
  dependsOn: readonly typeof A[] = [],
  order?: string[],
): AnyContribution => ({
  key,
  dependsOn,
  required: false,
  budgetMs: 200,
  contribute: async () => {
    order?.push(key.id);
    return value;
  },
});

const idsOf = (waves: readonly (readonly AnyContribution[])[]): string[][] =>
  waves.map((wave) => wave.map((contribution) => contribution.key.id).sort());

describe('planWaves', () => {
  it('puts independent contributors in one wave', () => {
    expect(idsOf(planWaves([producing(A, 'a'), producing(B, 'b')]))).toEqual([['a', 'b']]);
  });

  it('orders a dependent after what it depends on', () => {
    const waves = planWaves([producing(C, 'c', [A]), producing(A, 'a'), producing(B, 'b')]);
    expect(idsOf(waves)).toEqual([['a', 'b'], ['c']]);
  });

  it('chains transitive dependencies into successive waves', () => {
    const waves = planWaves([
      producing(C, 'c', [B]),
      producing(B, 'b', [A]),
      producing(A, 'a'),
    ]);
    expect(idsOf(waves)).toEqual([['a'], ['b'], ['c']]);
  });

  /**
   * A cycle admits no ordering, so failing at construction costs a restart.
   * The alternative is a contributor that reads an empty dependency for the
   * life of the process, which reads as the companion simply not knowing.
   */
  it('rejects a cycle at construction', () => {
    expect(() => planWaves([producing(A, 'a', [B]), producing(B, 'b', [A])])).toThrow(
      ContributorCycleError,
    );
  });

  it('rejects a self-dependency', () => {
    expect(() => planWaves([producing(A, 'a', [A])])).toThrow(ContributorCycleError);
  });

  it('rejects a dependency on something never registered', () => {
    expect(() => planWaves([producing(C, 'c', [A])])).toThrow(UnknownContributorError);
  });

  it('rejects a duplicate contributor id', () => {
    expect(() => planWaves([producing(A, 'first'), producing(A, 'second')])).toThrow(
      UnknownContributorError,
    );
  });
});

describe('runContributions', () => {
  it('runs a wave concurrently and the next wave after it', async () => {
    const order: string[] = [];
    const waves = planWaves([
      producing(C, 'c', [A], order),
      producing(A, 'a', [], order),
      producing(B, 'b', [], order),
    ]);

    const run = await runContributions(waves, request, options());

    expect(run.values.get('a')).toBe('a');
    expect(run.values.get('c')).toBe('c');
    // 'c' declared a dependency on 'a', so it must be last regardless of the
    // order the contributions were registered in.
    expect(order.indexOf('c')).toBe(2);
  });

  it('gives a dependent the value its dependency produced', async () => {
    let seen: string | undefined;
    const waves = planWaves([
      producing(A, 'goals-value'),
      {
        key: C,
        dependsOn: [A],
        required: false,
        budgetMs: 200,
        contribute: async (view) => {
          seen = view.get(A);
          return 'c';
        },
      },
    ]);

    await runContributions(waves, request, options());
    expect(seen).toBe('goals-value');
  });

  /**
   * The improvement over passing a bare empty value: "there are no goals" and
   * "the goal service timed out" call for different behaviour, and an empty
   * array cannot tell a dependent which happened.
   */
  it('tells a dependent why its dependency is missing', async () => {
    let value: string | undefined = 'unset';
    let outcome: string | undefined;

    const failing: AnyContribution = {
      key: A,
      dependsOn: [],
      required: false,
      budgetMs: 200,
      contribute: () => Promise.reject(new Error('goal service down')),
    };

    const waves = planWaves([
      failing,
      {
        key: C,
        dependsOn: [A],
        required: false,
        budgetMs: 200,
        contribute: async (view) => {
          value = view.get(A);
          outcome = view.outcomeOf(A);
          return 'c';
        },
      },
    ]);

    const run = await runContributions(waves, request, options());

    expect(value).toBeUndefined();
    expect(outcome).toBe('error');
    // A failed dependency degrades its dependent; it does not stop it.
    expect(run.values.get('c')).toBe('c');
  });

  /**
   * The restriction is what keeps the declared graph honest. Without it a
   * hidden edge would work by accident of wave ordering and break the day an
   * unrelated contributor is added.
   */
  it('hides a contributor that was not declared as a dependency', async () => {
    let leaked: string | undefined = 'unset';
    const waves = planWaves([
      producing(A, 'a'),
      producing(B, 'b'),
      {
        key: C,
        dependsOn: [B],
        required: false,
        budgetMs: 200,
        contribute: async (view) => {
          leaked = view.get(A);
          return 'c';
        },
      },
    ]);

    await runContributions(waves, request, options());
    expect(leaked).toBeUndefined();
  });

  it('stops at a failed required contributor and skips the waves after it', async () => {
    let laterRan = false;
    const waves = planWaves([
      {
        key: A,
        dependsOn: [],
        required: true,
        budgetMs: 200,
        contribute: () => Promise.reject(new Error('identity store down')),
      },
      {
        key: C,
        dependsOn: [A],
        required: false,
        budgetMs: 200,
        contribute: async () => {
          laterRan = true;
          return 'c';
        },
      },
    ]);

    const run = await runContributions(waves, request, options());

    expect(run.failure).toEqual({ id: 'a', outcome: 'error' });
    expect(laterRan).toBe(false);
    // The calls made before the failure survive, because a turn that failed is
    // the one whose port timings you most need.
    expect(run.calls).toHaveLength(1);
  });

  it('keeps every call, successful or not', async () => {
    const waves = planWaves([
      producing(A, 'a'),
      {
        key: B,
        dependsOn: [],
        required: false,
        budgetMs: 200,
        contribute: () => Promise.reject(new Error('down')),
      },
    ]);

    const run = await runContributions(waves, request, options());

    expect(run.calls).toHaveLength(2);
    expect(run.outcomes.get('a')).toBe('ok');
    expect(run.outcomes.get('b')).toBe('error');
  });

  it('reports cancellation rather than degrading', async () => {
    const controller = new AbortController();
    controller.abort();

    const waves = planWaves([producing(A, 'a')]);
    const run = await runContributions(waves, request, {
      signal: controller.signal,
      deadline: Deadline.after(systemClock, 1_000),
      turnId,
    });

    expect(run.aborted).toBe(true);
  });

  /**
   * Contributors share one budget policy because a contributor that invented
   * its own would degrade differently from the rest of the pipeline.
   */
  it('does not attempt a wave once the assembly deadline has passed', async () => {
    const clock = new FixedClock(1_000);
    const deadline = Deadline.after(clock, 100);
    clock.advance(200);

    let invoked = false;
    const waves = planWaves([
      {
        key: A,
        dependsOn: [],
        required: false,
        budgetMs: 200,
        contribute: async () => {
          invoked = true;
          return 'a';
        },
      },
    ]);

    const run = await runContributions(waves, request, {
      signal: new AbortController().signal,
      deadline,
      turnId,
    });

    expect(invoked).toBe(false);
    expect(run.outcomes.get('a')).toBe('not_attempted');
  });
});
