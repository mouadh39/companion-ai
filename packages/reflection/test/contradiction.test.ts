import { describe, expect, it } from 'vitest';
import { applyDecisions, reflect } from '@nexa/reflection';
import type { Insight, InsightDecision } from '@nexa/models';
import { USER, at, firstFormed, insightFrom, memoryOf, mintFrom, only } from './fixtures.js';

/** Three remarks that found "the user may enjoy chess". */
const likesChess = () => [
  memoryOf('I enjoy chess.', 0),
  memoryOf('Chess is fun.', 8),
  memoryOf('I am into chess.', 16),
];

const chessInsight = (): Insight =>
  insightFrom(
    firstFormed(reflect({ userId: USER, memories: likesChess(), existing: [], at: at(20) })),
    'ins-chess',
  );

const outcomeOf = (decisions: readonly InsightDecision[], key: string) =>
  decisions.find((decision) => decision.key === key)?.outcome;

describe('disagreement is held, not resolved', () => {
  it('contests rather than overturning on a single objection', () => {
    const held = chessInsight();
    const result = reflect({
      userId: USER,
      memories: [...likesChess(), memoryOf('I do not enjoy chess any more.', 30)],
      existing: [held],
      at: at(40),
    });

    const contested = only(result, 'contest')[0];
    expect(contested).toBeDefined();
    expect(contested?.outcome === 'contest' && contested.adjustment.status).toBe('contested');
  });

  it('lowers confidence when it is contested', () => {
    const held = chessInsight();
    const result = reflect({
      userId: USER,
      memories: [...likesChess(), memoryOf('I do not enjoy chess any more.', 30)],
      existing: [held],
      at: at(40),
    });

    const contested = only(result, 'contest')[0];
    expect(contested?.outcome === 'contest' && contested.adjustment.confidence).toBeLessThan(
      held.confidence,
    );
  });

  it('records the opposing memory rather than discarding it', () => {
    const held = chessInsight();
    const result = reflect({
      userId: USER,
      memories: [...likesChess(), memoryOf('I do not enjoy chess any more.', 30)],
      existing: [held],
      at: at(40),
    });

    const contested = only(result, 'contest')[0];
    expect(contested?.outcome === 'contest' && contested.adjustment.opposing).toHaveLength(1);
  });

  it('reports a contest as a contest even when support also grew', () => {
    // Reporting this as a reinforcement would bury the only part a person
    // would actually want to hear about.
    const held = chessInsight();
    const result = reflect({
      userId: USER,
      memories: [
        ...likesChess(),
        memoryOf('Chess is fun in the evening too.', 25),
        memoryOf('I do not enjoy chess any more.', 30),
      ],
      existing: [held],
      at: at(40),
    });

    expect(outcomeOf(result.decisions, held.key)).toBe('contest');
  });
});

describe('a claim is replaced only when it has genuinely turned over', () => {
  it('replaces when every objection is newer than every supporting memory', () => {
    const held = chessInsight();
    const result = reflect({
      userId: USER,
      memories: [
        ...likesChess(),
        memoryOf('I do not enjoy chess any more.', 30),
        memoryOf('I am not into chess now.', 38),
        memoryOf('Chess is not fun.', 45),
      ],
      existing: [held],
      at: at(50),
    });

    const replacement = only(result, 'replace')[0];
    expect(replacement).toBeDefined();
    expect(replacement?.outcome === 'replace' && replacement.draft.polarity).toBe('denies');
    expect(replacement?.outcome === 'replace' && replacement.draft.supersedes).toBe(held.id);
    expect(replacement?.outcome === 'replace' && replacement.draft.statement).toBe(
      'The user may not enjoy chess.',
    );
  });

  it('contests instead when the disagreement is interleaved with the support', () => {
    // Not "they changed their mind" but "they have always been inconsistent
    // about this", and only the first is a reason to replace.
    const held = chessInsight();
    const result = reflect({
      userId: USER,
      memories: [
        ...likesChess(),
        memoryOf('I do not enjoy chess any more.', 4),
        memoryOf('I am not into chess now.', 12),
        memoryOf('Chess is not fun.', 45),
      ],
      existing: [held],
      at: at(50),
    });

    expect(outcomeOf(result.decisions, held.key)).toBe('contest');
  });

  it('keeps the replaced insight readable', () => {
    const held = chessInsight();
    const result = reflect({
      userId: USER,
      memories: [
        ...likesChess(),
        memoryOf('I do not enjoy chess any more.', 30),
        memoryOf('I am not into chess now.', 38),
        memoryOf('Chess is not fun.', 45),
      ],
      existing: [held],
      at: at(50),
    });

    const store = applyDecisions([held], result.decisions, USER, mintFrom('ins'));
    const old = store.find((insight) => insight.id === held.id);
    const replacement = store.find((insight) => insight.id !== held.id);

    expect(old?.status).toBe('superseded');
    expect(old?.statement).toBe(held.statement);
    expect(old?.supersededBy).toBe(replacement?.id);
    expect(replacement?.supersedes).toBe(held.id);
  });

  it('does not carry the old evidence forward as opposition', () => {
    // A superseded claim keeps its own record. Dragging its evidence into the
    // replacement would permanently contest a claim whose whole point is that
    // the user has moved on.
    const held = chessInsight();
    const result = reflect({
      userId: USER,
      memories: [
        ...likesChess(),
        memoryOf('I do not enjoy chess any more.', 30),
        memoryOf('I am not into chess now.', 38),
        memoryOf('Chess is not fun.', 45),
      ],
      existing: [held],
      at: at(50),
    });

    const replacement = only(result, 'replace')[0];
    expect(replacement?.outcome === 'replace' && replacement.draft.opposing).toHaveLength(0);
    expect(replacement?.outcome === 'replace' && replacement.draft.status).toBe('active');
  });
});

describe('denials that cannot stand alone', () => {
  it('will not found a struggle insight on the absence of one', () => {
    const result = reflect({
      userId: USER,
      memories: [
        memoryOf('I am not struggling with the shader at all.', 0),
        memoryOf('I do not struggle with the shader now.', 5),
        memoryOf('I am not stuck on the shader.', 12),
      ],
      existing: [],
      at: at(20),
    });

    const declined = only(result, 'decline').find(
      (decision) =>
        decision.outcome === 'decline' && decision.reason === 'phrasing_not_licensed',
    );
    expect(declined).toBeDefined();
  });

  it('lets a preference denial stand, because that one is worth knowing', () => {
    const result = reflect({
      userId: USER,
      memories: [
        memoryOf('I do not like coriander.', 0),
        memoryOf('I would rather not have coriander.', 12),
      ],
      existing: [],
      at: at(15),
    });

    const draft = firstFormed(result);
    expect(draft.polarity).toBe('denies');
    expect(draft.statement).toContain('may not prefer');
  });
});

describe('a split verdict concludes nothing', () => {
  it('declines when the evidence is evenly divided', () => {
    const result = reflect({
      userId: USER,
      memories: [
        memoryOf('I enjoy chess.', 0),
        memoryOf('Chess is fun.', 8),
        memoryOf('I am into chess.', 10),
        memoryOf('I do not enjoy chess any more.', 12),
        memoryOf('I am not into chess now.', 14),
        memoryOf('Chess is not fun.', 16),
      ],
      existing: [],
      at: at(25),
    });

    const declined = only(result, 'decline').find(
      (decision) => decision.outcome === 'decline' && decision.reason === 'evidence_conflicts',
    );
    expect(declined).toBeDefined();
  });
});
