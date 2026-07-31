import { describe, expect, it } from 'vitest';
import { defaultBudget, isDegraded, totalSpent } from '@nexa/models';
import type { ContextBudget, SectionOmission } from '@nexa/models';

/**
 * `degraded` is the headline quality signal for a system designed to fail
 * quietly: it will show ~0% errors while silently getting worse, so the
 * degradation ratio is the number that actually tracks whether answers are
 * still good. Everything here protects that signal from being diluted.
 */

const withOmissions = (omissions: readonly SectionOmission[]): ContextBudget => ({
  ...defaultBudget(),
  omissions,
});

describe('isDegraded', () => {
  it('is false when nothing was dropped', () => {
    expect(isDegraded(defaultBudget())).toBe(false);
  });

  /**
   * The distinction the whole signal rests on. A companion with no active
   * goals, no relevant memories and no tools is not degraded — those sections
   * had nothing to say. Counting them pins the ratio at ~100% and it tracks
   * nothing.
   */
  it('is false when sections were merely empty', () => {
    const budget = withOmissions([
      { section: 'goals', reason: 'empty' },
      { section: 'retrieved_memories', reason: 'empty' },
      { section: 'tools', reason: 'empty' },
    ]);

    expect(isDegraded(budget)).toBe(false);
  });

  it.each([
    ['port_timeout' as const, 'world' as const],
    ['port_error' as const, 'retrieved_memories' as const],
    ['budget_exceeded' as const, 'working_memory' as const],
    ['not_attempted' as const, 'emotion' as const],
  ])('is true when a section was lost to %s', (reason, section) => {
    expect(isDegraded(withOmissions([{ section, reason }]))).toBe(true);
  });

  it('is true when a real loss sits alongside empty sections', () => {
    const budget = withOmissions([
      { section: 'goals', reason: 'empty' },
      { section: 'retrieved_memories', reason: 'port_timeout' },
    ]);

    expect(isDegraded(budget)).toBe(true);
  });

  /** Nothing is lost by the sharper boolean: the full list still carries `empty`. */
  it('keeps empty omissions on the record regardless', () => {
    const budget = withOmissions([{ section: 'goals', reason: 'empty' }]);

    expect(isDegraded(budget)).toBe(false);
    expect(budget.omissions).toHaveLength(1);
  });
});

describe('totalSpent', () => {
  it('sums what each section consumed', () => {
    const budget: ContextBudget = {
      ...defaultBudget(),
      spent: { identity: 120, personality: 60, retrieved_memories: 900 },
    };

    expect(totalSpent(budget)).toBe(1_080);
  });

  it('is zero before assembly has spent anything', () => {
    expect(totalSpent(defaultBudget())).toBe(0);
  });
});
