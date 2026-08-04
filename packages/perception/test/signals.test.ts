import { describe, expect, it } from 'vitest';
import { MIN_WORDS_FOR_STYLE, referencesIn, stanceFor } from '@nexa/perception';
import { allOn, dimensionsIn, on, read, turnOf, unknownFor } from './fixtures.js';

describe('conversation', () => {
  it('reads a question mark as a question', () => {
    expect(stanceFor(read('Is the build green?'), 'question')).toBe('observed');
  });

  it('reads an opener as a question without one', () => {
    expect(stanceFor(read('How do I clear the cache'), 'question')).toBe('observed');
  });

  it('finds a question that is not at the end', () => {
    // An end-anchored check loses the one part of the message the companion is
    // actually being asked to answer.
    expect(stanceFor(read('Is the build green? Never mind, I found it.'), 'question')).toBe(
      'observed',
    );
  });

  it('reads a greeting and a farewell', () => {
    expect(stanceFor(read('Hello!'), 'greeting')).toBe('observed');
    expect(stanceFor(read('Right, good night.'), 'farewell')).toBe('observed');
  });

  it('only reads a greeting at the opening', () => {
    // "Say hi to the team for me" is not the user greeting the companion.
    expect(stanceFor(read('Could you say hi to the team for me?'), 'greeting')).toBe('unknown');
  });

  it('separates an explicit correction from a soft one', () => {
    expect(stanceFor(read("That's wrong, the port is 8080."), 'correction')).toBe('observed');
    expect(stanceFor(read('Actually, the port is 8080.'), 'correction')).toBe('possible');
  });

  it('reports agreement and disagreement together when both are present', () => {
    // "Yes, but I don't think that works" is genuinely both, and picking one
    // would discard whichever half the tie-break disliked.
    const outcome = read("Yes, exactly — but I don't think that works.");

    expect(stanceFor(outcome, 'agreement')).toBe('observed');
    expect(stanceFor(outcome, 'disagreement')).toBe('observed');
  });

  it('needs a conversation before it can see a topic shift', () => {
    const first = read('Let us talk about the garden shed instead.');
    expect(unknownFor(first, 'topic_shift')).toBeDefined();
  });

  it('notices a subject the recent turns share no words with', () => {
    const outcome = read('Let us talk about the garden shed instead.', {
      conversation: [
        turnOf('user', 'The shader compiler keeps failing on Android.', -3),
        turnOf('companion', 'That is usually a precision qualifier problem.', -2),
      ],
    });

    expect(stanceFor(outcome, 'topic_shift')).toBe('possible');
  });

  it('does not call a continuation a shift', () => {
    const outcome = read('The shader compiler is still failing on Android builds.', {
      conversation: [turnOf('user', 'The shader compiler keeps failing on Android.', -3)],
    });

    expect(stanceFor(outcome, 'topic_shift')).toBe('unknown');
  });

  it('does not read a short acknowledgement as a shift', () => {
    const outcome = read('Sure, ok.', {
      conversation: [turnOf('user', 'The shader compiler keeps failing on Android.', -3)],
    });

    expect(stanceFor(outcome, 'topic_shift')).toBe('unknown');
  });
});

describe('communication', () => {
  it('measures verbosity on every message with words in it', () => {
    const brief = on(read('Fix it.'), 'verbosity');
    const long = on(read('a '.repeat(200)), 'verbosity');

    expect(brief?.magnitude).toBeLessThan(long?.magnitude ?? 0);
    expect(brief?.stance).toBe('observed');
  });

  it('reads hedges as both uncertainty and hesitation, without either borrowing', () => {
    const outcome = read('I guess maybe that could be the problem, sort of.');

    expect(stanceFor(outcome, 'uncertainty')).toBe('observed');
    expect(stanceFor(outcome, 'hesitation')).toBe('observed');
    expect(on(outcome, 'uncertainty')?.confidence).toBe(on(outcome, 'hesitation')?.confidence);
  });

  it('reads commitment as certainty', () => {
    expect(stanceFor(read('That is definitely the problem, I know it.'), 'certainty')).toBe(
      'observed',
    );
  });

  it('declines to judge the style of a very short message', () => {
    // A three-word message is not direct or indirect; it is short, and
    // verbosity already said so.
    const outcome = read('Fix it.');

    expect(stanceFor(outcome, 'directness')).toBe('unknown');
    expect(MIN_WORDS_FOR_STYLE).toBeGreaterThan(2);
  });

  it('reads stated urgency as observed and typography as possible', () => {
    expect(stanceFor(read('I need this fixed asap, the deadline is today.'), 'urgency')).toBe(
      'observed',
    );

    const shouted = read('THE BUILD IS BROKEN!!');
    expect(stanceFor(shouted, 'urgency')).toBe('possible');
  });

  it('keeps the two urgency readings as separate observations', () => {
    // Some people type in capitals. A companion that read every such message as
    // an emergency would be wrong about the same person every day, so the
    // typographic reading never merges into the stated one.
    const outcome = read('I NEED THIS ASAP!!');
    const urgency = allOn(outcome, 'urgency');

    expect(urgency).toHaveLength(2);
    expect(urgency.map((observation) => observation.stance).sort()).toStrictEqual([
      'observed',
      'possible',
    ]);
  });
});

describe('interaction', () => {
  it('reads several intentions from one message without choosing between them', () => {
    // Picking a single intent is a decision, and decisions belong to planning.
    const outcome = read(
      'Can you help me plan next week? I want to understand how the scheduler works.',
    );
    const found = dimensionsIn(outcome);

    expect(found).toContain('help_request');
    expect(found).toContain('planning');
    expect(found).toContain('learning');
  });

  it('reads reflection', () => {
    expect(stanceFor(read('Looking back, I tend to leave things until the deadline.'), 'reflection'))
      .toBe('observed');
  });

  it('reads brainstorming', () => {
    expect(stanceFor(read('What if we cached it instead? We could try a few options.'), 'brainstorming'))
      .toBe('observed');
  });

  it('reads small talk', () => {
    expect(stanceFor(read('Thanks, nice one!'), 'casual')).toBe('observed');
  });
});

describe('references are not observations', () => {
  it('collects proper nouns and quoted spans', () => {
    const outcome = read('I am debugging the Nexa shader with "precision highp float" set.');

    expect(outcome.references.map((reference) => reference.text)).toContain('Nexa');
    expect(outcome.references.some((reference) => reference.kind === 'quoted')).toBe(true);
  });

  it('does not treat a sentence-initial capital as a reference', () => {
    // Every sentence starts with a capital. Counting them makes "The" the most
    // referenced entity in the corpus.
    expect(referencesIn('The build failed. Something broke.', 10)).toStrictEqual([]);
  });

  it('stays out of the dimension vocabulary entirely', () => {
    // A reference is something in the world; every dimension is a reading of
    // the user. Scoring them alike would put "she mentioned Unity" and "she may
    // be frustrated" on the same footing.
    const outcome = read('The build for Nexa is failing.');

    expect(outcome.references.length).toBeGreaterThan(0);
    expect(dimensionsIn(outcome)).not.toContain('reference' as never);
  });

  it('is bounded', () => {
    const many = Array.from({ length: 40 }, (_, index) => `Thing${index}`).join(' and ');
    expect(read(`It broke: ${many}`).references.length).toBeLessThanOrEqual(10);
  });
});
