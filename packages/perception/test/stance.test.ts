import { describe, expect, it } from 'vitest';
import { OBSERVATION_DIMENSIONS } from '@nexa/models';
import { DEFAULT_CONFIG, POSSIBLE_CEILING, perceive, stanceFor } from '@nexa/perception';
import { at, dimensionsIn, on, read, said, unknownFor } from './fixtures.js';

describe('the three cases from the brief', () => {
  it('reads a stated emotion as observed', () => {
    const outcome = read('I am frustrated.');

    expect(stanceFor(outcome, 'frustration')).toBe('observed');
    expect(on(outcome, 'frustration')?.evidence[0]?.kind).toBe('self_report');
  });

  it('reads an implied one as possible', () => {
    const outcome = read('I guess nothing works.');

    expect(stanceFor(outcome, 'frustration')).toBe('possible');
    expect(on(outcome, 'frustration')?.confidence).toBeLessThanOrEqual(POSSIBLE_CEILING);
  });

  it('reads silence as unknown, and says so', () => {
    const outcome = read('');

    expect(stanceFor(outcome, 'frustration')).toBe('unknown');
    expect(outcome.observations).toStrictEqual([]);
    // Not implied by absence. Silence is a real answer and gets a real row.
    expect(unknownFor(outcome, 'frustration')?.reason).toBe('insufficient_input');
  });

  it('never invents an emotional state', () => {
    const outcome = read('The deployment finished at four.');

    expect(
      outcome.observations.filter((observation) => observation.family === 'emotion'),
    ).toStrictEqual([]);
  });
});

describe('the line between stating and suggesting', () => {
  it('tells "I am frustrated" from "this is frustrating"', () => {
    // One word apart, and an enormous amount of warrant apart: a person telling
    // you about themselves versus a person telling you about a compiler.
    expect(stanceFor(read('I am frustrated with this build.'), 'frustration')).toBe('observed');
    expect(stanceFor(read('This build is frustrating.'), 'frustration')).toBe('possible');
  });

  it('does not read a denial as a self-report', () => {
    // The sentence shape most likely to be misread: someone saying they are
    // fine while describing something that is not.
    const outcome = read('I am fine but the deploy was frustrating.');

    expect(stanceFor(outcome, 'frustration')).toBe('possible');
  });

  it('caps anything inferred below anything stated', () => {
    const stated = on(read('I am exhausted.'), 'fatigue');
    const implied = on(read('This has been a long one, nothing works.'), 'frustration');

    expect(stated?.confidence).toBeGreaterThan(POSSIBLE_CEILING);
    expect(implied?.confidence).toBeLessThanOrEqual(POSSIBLE_CEILING);
  });

  it('never lets a chain of hints reach a statement’s confidence', () => {
    // Six indirect cues in one message. However many there are, inference is
    // capped — that is the mechanical form of "prefer uncertainty".
    const outcome = read(
      'Nothing works, still broken, keeps failing, no luck, same error, tried everything.',
    );

    expect(on(outcome, 'frustration')?.confidence).toBeLessThanOrEqual(POSSIBLE_CEILING);
  });
});

describe('unknown carries a reason, not just an absence', () => {
  it('separates "nothing was there" from "nobody looked"', () => {
    const outcome = read('Hello.');

    // The text channel can report frustration and did not find it.
    expect(unknownFor(outcome, 'frustration')?.reason).toBe('no_evidence');
  });

  it('reports a dimension no supplied channel can reach', () => {
    const outcome = perceive({
      percepts: [said('Hello.')],
      at: at(0),
      config: { ...DEFAULT_CONFIG, extractors: [] },
    });

    expect(unknownFor(outcome, 'frustration')?.reason).toBe('no_channel');
  });

  it('accounts for every dimension as observed, possible or unknown', () => {
    const outcome = read('I am frustrated, I guess nothing works, can you help?');

    for (const dimension of OBSERVATION_DIMENSIONS) {
      const stance = stanceFor(outcome, dimension);
      const isUnknown = unknownFor(outcome, dimension) !== undefined;
      expect(stance === 'unknown', `'${dimension}' disagrees with its unknown row`).toBe(
        isUnknown,
      );
    }
  });

  it('can be switched off for a caller that does not want the noise', () => {
    const outcome = perceive({
      percepts: [said('Hello.')],
      at: at(0),
      config: { ...DEFAULT_CONFIG, reportUnknown: false },
    });

    expect(outcome.unknown).toStrictEqual([]);
    expect(dimensionsIn(outcome)).toContain('greeting');
  });
});
