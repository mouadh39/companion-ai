import { describe, expect, it } from 'vitest';
import type { ObservationEvidence } from '@nexa/models';
import { OBSERVATION_DIMENSIONS, OBSERVATION_STANCES } from '@nexa/models';
import {
  MAX_CORROBORATION_BONUS,
  OBSERVED_CEILING,
  POSSIBLE_CEILING,
  ceilingFor,
  evidence,
  magnitudeOf,
  policyFor,
  score,
} from '@nexa/perception';
import { on, read } from './fixtures.js';

const cue = (strength: number, name = 'cue'): ObservationEvidence =>
  evidence('phrase', name, name, strength);

describe('confidence is never borrowed', () => {
  it('is a function of one observation’s own evidence and nothing else', () => {
    // The guarantee is the signature: `score` is never handed the collection, so
    // there is nothing for it to borrow from.
    expect(score('frustration', 'observed', [cue(0.7)])).toStrictEqual(
      score('frustration', 'observed', [cue(0.7)]),
    );
  });

  it('does not move when unrelated observations appear beside it', () => {
    // The property that matters at the pass level. Three more readings in the
    // same message must not make an existing one surer.
    const alone = on(read('I am frustrated.'), 'frustration');
    const crowded = on(
      read('I am frustrated. Can you help? I guess nothing works. Thanks!'),
      'frustration',
    );

    expect(crowded?.confidence).toBe(alone?.confidence);
  });

  it('does not let a weak reading strengthen a different dimension', () => {
    const alone = on(read('Can you help me with this?'), 'help_request');
    const beside = on(
      read('Can you help me with this? I guess nothing works, maybe.'),
      'help_request',
    );

    expect(beside?.confidence).toBe(alone?.confidence);
  });

  it('does not let an emotional reading raise a conversational one', () => {
    // The question is terminal in both, so the structural evidence is identical
    // and only the surrounding emotion differs. Comparing a terminal question
    // against a mid-message one would be comparing two different pieces of
    // evidence and proving nothing about borrowing.
    const plain = on(read('Is the build green?'), 'question');
    const charged = on(read('I am so frustrated! Is the build green?'), 'question');

    expect(charged?.confidence).toBe(plain?.confidence);
  });
});

describe('what does raise confidence', () => {
  it('takes the strongest cue as the level, so weak corroboration never weakens', () => {
    // Not an average. A message with a self-report *and* a passing mention must
    // not read as less certain than the self-report alone — which is exactly
    // what averaging would do.
    const both = score('fatigue', 'observed', [cue(0.7), cue(0.3, 'weak')]).confidence;
    const strongOnly = score('fatigue', 'observed', [cue(0.7)]).confidence;
    const weakOnly = score('fatigue', 'observed', [cue(0.3, 'weak')]).confidence;

    expect(both).toBeGreaterThanOrEqual(strongOnly);
    expect(both).toBeGreaterThan(weakOnly);
  });

  it('adds a bounded amount for more cues supporting the same reading', () => {
    const one = score('frustration', 'possible', [cue(0.45)]).confidence;
    const many = score(
      'frustration',
      'possible',
      Array.from({ length: 20 }, (_, index) => cue(0.45, `cue${index}`)),
    ).confidence;

    expect(many).toBeGreaterThan(one);
    expect(many - one).toBeLessThanOrEqual(MAX_CORROBORATION_BONUS + 1e-9);
  });

  it('never turns emphasis into certainty', () => {
    // Twenty repetitions of a weak cue must not out-argue one clear statement.
    const repeated = score(
      'frustration',
      'possible',
      Array.from({ length: 20 }, (_, index) => cue(0.45, `cue${index}`)),
    ).confidence;
    const stated = score('frustration', 'observed', [cue(0.85)]).confidence;

    expect(repeated).toBeLessThan(stated);
  });

  it('returns nothing at all for no evidence', () => {
    expect(score('frustration', 'observed', []).confidence).toBe(0);
  });
});

describe('ceilings', () => {
  it('caps every dimension below certainty, at every stance', () => {
    for (const dimension of OBSERVATION_DIMENSIONS) {
      for (const stance of OBSERVATION_STANCES) {
        const scored = score(dimension, stance, [cue(1), cue(1, 'b'), cue(1, 'c')]);
        expect(scored.confidence, `${dimension}/${stance}`).toBeLessThan(1);
        expect(scored.confidence).toBeLessThanOrEqual(ceilingFor(dimension, stance));
      }
    }
  });

  it('caps anything possible below anything observed can reach', () => {
    for (const dimension of OBSERVATION_DIMENSIONS) {
      expect(ceilingFor(dimension, 'possible')).toBeLessThanOrEqual(POSSIBLE_CEILING);
      expect(ceilingFor(dimension, 'possible')).toBeLessThanOrEqual(
        ceilingFor(dimension, 'observed'),
      );
    }
  });

  it('holds emotional readings below structural ones', () => {
    // A question mark is not a matter of opinion; someone's mood is.
    expect(policyFor('frustration').ceiling).toBeLessThan(policyFor('question').ceiling);
    expect(policyFor('sadness').ceiling).toBeLessThan(policyFor('verbosity').ceiling);
  });

  it('reports when the ceiling rather than the evidence decided', () => {
    expect(score('calm', 'observed', [cue(1)]).capped).toBe(true);
    expect(score('calm', 'observed', [cue(0.3)]).capped).toBe(false);
  });

  it('keeps the absolute ceilings ordered', () => {
    expect(POSSIBLE_CEILING).toBeLessThan(OBSERVED_CEILING);
    expect(OBSERVED_CEILING).toBeLessThan(1);
  });
});

describe('magnitude is not confidence', () => {
  it('reports strong feeling on weak evidence without inflating either', () => {
    // A single hedged phrase is weak evidence of considerable frustration.
    // Collapsing the two would report mild frustration — a third claim nothing
    // in the message supports.
    const outcome = read('This is so frustrating.');
    const observation = on(outcome, 'frustration');

    expect(observation?.magnitude).toBeGreaterThan(observation?.confidence ?? 1);
  });

  it('moves with intensifiers while confidence does not', () => {
    const plain = on(read('I am frustrated.'), 'frustration');
    const intense = on(read('I am so frustrated.'), 'frustration');

    expect(intense?.magnitude).toBeGreaterThan(plain?.magnitude ?? 1);
    expect(intense?.confidence).toBe(plain?.confidence);
  });

  it('moves with diminishers the same way', () => {
    const plain = on(read('I am frustrated.'), 'frustration');
    const mild = on(read('I am a bit frustrated.'), 'frustration');

    expect(mild?.magnitude).toBeLessThan(plain?.magnitude ?? 0);
    expect(mild?.confidence).toBe(plain?.confidence);
  });

  it('is total over nonsense', () => {
    expect(magnitudeOf(Number.NaN)).toBe(0);
    expect(magnitudeOf(-5)).toBe(0);
    expect(magnitudeOf(12)).toBe(1);
  });

  it('has no ceiling of its own', () => {
    // A ceiling on magnitude would be the engine deciding someone cannot be
    // very frustrated.
    expect(magnitudeOf(1)).toBe(1);
  });
});

describe('floors', () => {
  it('demands more of an emotional reading than of a structural one', () => {
    expect(policyFor('frustration').floor).toBeGreaterThan(policyFor('verbosity').floor);
  });

  it('reports a reading that fell below its floor as no_evidence, not as absent', () => {
    for (const dimension of OBSERVATION_DIMENSIONS) {
      expect(policyFor(dimension).floor).toBeGreaterThan(0);
      expect(policyFor(dimension).floor).toBeLessThan(policyFor(dimension).ceiling);
    }
  });
});
