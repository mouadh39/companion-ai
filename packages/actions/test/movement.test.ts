import { describe, expect, it } from 'vitest';
import type { Action, FollowAction, MoveAction, StopAction } from '../dist/index.js';
import { validateAction } from '../dist/index.js';

/**
 * The invariants the movement vocabulary carries that its types cannot.
 *
 * `MoveAction` makes `target` and `direction` independently optional, because
 * the three things a person actually asks for are differently shaped — "come
 * here" is a target, "go back two steps" is a direction and a distance, "move
 * closer" is both. That flexibility is deliberate and it leaves exactly two
 * holes the compiler cannot close: an action naming neither, and a
 * target-relative direction with no target. Both are checked here.
 *
 * The distance ceilings are the other subject. They are not navigation limits —
 * the client's own pathfinding owns those — they catch a generation that
 * produced a number with the wrong magnitude, which is a failure mode worth
 * naming separately from a malformed one. "Move back 200" is far more likely to
 * be a model that meant centimetres than a request to leave the building, and
 * `budget` rather than `schema` is what says so.
 */

const base = { id: 'action-1', decisionId: 'decision-1' } as const;

const move = (over: Partial<MoveAction> = {}): Action =>
  ({
    ...base,
    type: 'move',
    target: null,
    direction: null,
    distance: null,
    distanceUnit: null,
    mode: 'walk',
    ...over,
  }) as Action;

const follow = (over: Partial<FollowAction> = {}): Action =>
  ({ ...base, type: 'follow', target: 'user', distance: null, mode: 'walk', ...over }) as Action;

const stop = (over: Partial<StopAction> = {}): Action =>
  ({ ...base, type: 'stop', scope: 'all', ...over }) as Action;

describe('validateAction — move', () => {
  it('accepts a bare target', () => {
    expect(validateAction(move({ target: 'user' })).ok).toBe(true);
  });

  it('accepts a direction with a distance and its unit', () => {
    const result = validateAction(
      move({ direction: 'backward', distance: 2, distanceUnit: 'steps' }),
    );
    expect(result.ok).toBe(true);
  });

  it('accepts a name the backend cannot enumerate', () => {
    // Which names resolve is a fact about the client's room. An unknown one
    // comes back as a `skipped` outcome rather than being refused here.
    expect(validateAction(move({ target: 'the blue chair' })).ok).toBe(true);
  });

  it('rejects a move naming neither a target nor a direction', () => {
    const result = validateAction(move());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.reason).toBe('schema');
  });

  it('rejects a target-relative direction with no target', () => {
    for (const direction of ['toward', 'away_from'] as const) {
      const result = validateAction(move({ direction }));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.detail).toContain('relative to a target');
    }
  });

  it('rejects a distance with no unit, and a unit with no distance', () => {
    expect(validateAction(move({ target: 'user', distance: 2 })).ok).toBe(false);
    expect(validateAction(move({ target: 'user', distanceUnit: 'steps' })).ok).toBe(false);
  });

  it('rejects a non-positive or non-finite distance', () => {
    for (const distance of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const result = validateAction(move({ direction: 'forward', distance, distanceUnit: 'metres' }));
      expect(result.ok).toBe(false);
    }
  });

  it('bounds steps and metres differently, and calls it a budget failure', () => {
    // A step is a much larger unit than a metre, so the ceilings differ. Twenty
    // steps is a long walk; twenty metres is a room.
    expect(validateAction(move({ direction: 'forward', distance: 20, distanceUnit: 'steps' })).ok).toBe(true);
    expect(validateAction(move({ direction: 'forward', distance: 20, distanceUnit: 'metres' })).ok).toBe(true);

    const tooManySteps = validateAction(
      move({ direction: 'forward', distance: 21, distanceUnit: 'steps' }),
    );
    expect(tooManySteps.ok).toBe(false);
    if (!tooManySteps.ok) expect(tooManySteps.error.reason).toBe('budget');

    expect(validateAction(move({ direction: 'forward', distance: 51, distanceUnit: 'metres' })).ok).toBe(false);
  });
});

describe('validateAction — follow', () => {
  it('accepts a target', () => {
    expect(validateAction(follow()).ok).toBe(true);
  });

  it('rejects a follow with no target', () => {
    // Unlike a move, there is no egocentric fallback that means anything:
    // following in a direction is just walking.
    expect(validateAction(follow({ target: '' })).ok).toBe(false);
  });

  it('bounds how far behind the companion may trail', () => {
    expect(validateAction(follow({ distance: 10 })).ok).toBe(true);
    const result = validateAction(follow({ distance: 11 }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.reason).toBe('budget');
  });

  it('rejects a non-positive distance', () => {
    expect(validateAction(follow({ distance: 0 })).ok).toBe(false);
  });
});

describe('validateAction — stop', () => {
  it('accepts every scope', () => {
    for (const scope of ['movement', 'follow', 'all'] as const) {
      expect(validateAction(stop({ scope })).ok).toBe(true);
    }
  });
});
