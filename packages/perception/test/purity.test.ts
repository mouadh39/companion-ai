import { describe, expect, it } from 'vitest';
import { primaryIntent } from '@nexa/models';
import type { TextPercept } from '@nexa/models';
import { perceive, stanceFor, toPerception } from '@nexa/perception';
import type { PerceptionRequest } from '@nexa/perception';
import { at, on, read, relationshipOf, said, turnOf } from './fixtures.js';

const world = (): PerceptionRequest => ({
  percepts: [
    said(
      'Actually, I guess nothing works — I am so frustrated with the Nexa shader. Can you help me plan a fix for tomorrow?',
    ),
  ],
  conversation: [
    turnOf('user', 'The shader compiler keeps failing on Android.', -6),
    turnOf('companion', 'That is usually a precision qualifier problem.', -5),
  ],
  relationship: relationshipOf(),
  at: at(0),
});

describe('purity', () => {
  it('never mutates what it was given', () => {
    const request = world();
    const snapshot = structuredClone({
      percepts: request.percepts,
      conversation: request.conversation,
      relationship: request.relationship,
    });

    perceive(request);

    expect({
      percepts: request.percepts,
      conversation: request.conversation,
      relationship: request.relationship,
    }).toStrictEqual(snapshot);
  });

  it('returns a deeply equal result for the same request', () => {
    expect(perceive(world())).toStrictEqual(perceive(world()));
  });

  it('reads no clock — the instant comes from the argument', () => {
    expect(perceive({ ...world(), at: at(90) }).at).toBe(at(90));
    expect(perceive(world()).observations[0]?.at).toBe(at(0));
  });

  it('does not depend on the order percepts arrived in', () => {
    const request = world();
    const forwards = perceive(request);
    const backwards = perceive({ ...request, percepts: [...request.percepts].reverse() });

    expect(backwards).toStrictEqual(forwards);
  });

  it('orders observations by family rather than by strength', () => {
    // A confidence-sorted list invites a reader to treat the top entry as *the*
    // reading, which is exactly the summary this engine refuses to produce.
    const families = perceive(world()).observations.map((observation) => observation.family);

    expect([...families]).toStrictEqual([...families].sort());
  });
});

describe('replay', () => {
  it('reconstructs the same reading from a serialised request', () => {
    const request = world();
    const round = JSON.parse(JSON.stringify(request)) as PerceptionRequest;

    expect(perceive(round)).toStrictEqual(perceive(request));
  });

  it('produces the same confidences across runs', () => {
    const a = perceive(world()).observations.map((o) => [o.dimension, o.confidence]);
    const b = perceive(world()).observations.map((o) => [o.dimension, o.confidence]);

    expect(b).toStrictEqual(a);
  });

  it('quotes the user rather than paraphrasing them', () => {
    // An explanation that paraphrased would be an interpretation wearing an
    // observation's clothes. The point of quoting is that a reader can check
    // the engine's reading against the words.
    const outcome = perceive(world());
    const text = request(world());

    for (const observation of outcome.observations) {
      for (const cue of observation.evidence) {
        if (cue.excerpt.length === 0 || cue.kind === 'structural' || cue.kind === 'contextual') {
          continue;
        }
        expect(text.toLowerCase()).toContain(cue.excerpt.replace('…', '').toLowerCase().slice(0, 20));
      }
    }
  });
});

const request = (input: PerceptionRequest): string =>
  input.percepts
    .filter((percept) => percept.channel === 'text')
    .map((percept) => (percept as TextPercept).text)
    .join(' ');

describe('totality', () => {
  it('handles no percepts at all', () => {
    const outcome = perceive({ percepts: [], at: at(0) });

    expect(outcome.observations).toStrictEqual([]);
    expect(outcome.tensions).toStrictEqual([]);
    expect(outcome.channels).toStrictEqual([]);
  });

  it('handles whitespace as silence rather than as content', () => {
    const outcome = read('   \n  ');

    expect(outcome.observations).toStrictEqual([]);
    expect(stanceFor(outcome, 'verbosity')).toBe('unknown');
  });

  it('handles punctuation-only input', () => {
    expect(() => read('?!?!')).not.toThrow();
  });

  it('handles a very long message', () => {
    const long = `${'I am frustrated. '.repeat(500)}`;
    expect(() => read(long)).not.toThrow();
    expect(on(read(long), 'frustration')?.confidence).toBeLessThan(1);
  });

  it('handles a message with no conversation and no relationship', () => {
    const outcome = perceive({ percepts: [said('Hello there.')], at: at(0) });

    expect(stanceFor(outcome, 'greeting')).toBe('observed');
    expect(stanceFor(outcome, 'topic_shift')).toBe('unknown');
  });

  it('bounds what it quotes back', () => {
    const outcome = read(`I am frustrated because ${'x'.repeat(500)}`);

    for (const observation of outcome.observations) {
      for (const cue of observation.evidence) expect(cue.excerpt.length).toBeLessThanOrEqual(80);
    }
  });
});

describe('the bridge to Core', () => {
  it('produces a Perception Core can read', () => {
    const outcome = perceive(world());
    const perception = toPerception(outcome, world().percepts);

    expect(perception.text.length).toBeGreaterThan(0);
    expect(perception.intents.length).toBeGreaterThan(0);
    expect(Object.keys(perception).sort()).toStrictEqual([
      'emotion',
      'entities',
      'intents',
      'text',
    ]);
  });

  it('ranks intents so the primary one is stable', () => {
    const perception = toPerception(perceive(world()), world().percepts);
    const again = toPerception(perceive(world()), world().percepts);

    expect(primaryIntent(again)).toBe(primaryIntent(perception));
    expect(perception.intents).toStrictEqual(
      [...perception.intents].sort(
        (a, b) => b.confidence - a.confidence || a.kind.localeCompare(b.kind),
      ),
    );
  });

  it('takes the strongest reading per intent rather than summing them', () => {
    // Adding them would let three weak hints outrank one clear question — the
    // borrowing forbidden upstream, arriving through the projection.
    const one = toPerception(perceive({ percepts: [said('How do I fix this?')], at: at(0) }), []);
    const many = toPerception(
      perceive({
        percepts: [said('How do I fix this? What is the cause? Why does it break?')],
        at: at(0),
      }),
      [],
    );

    const asked = (p: typeof one) => p.intents.find((intent) => intent.kind === 'question');
    expect(asked(many)?.confidence).toBe(asked(one)?.confidence);
  });

  it('flags a turn that asks for support', () => {
    const outcome = perceive({ percepts: [said('I am really sad today.')], at: at(0) });
    const perception = toPerception(outcome, []);

    expect(perception.intents.some((intent) => intent.kind === 'emotional_support')).toBe(true);
    expect(perception.emotion?.emotion).toBe('sad');
  });

  it('passes no emotion at all when nothing was read', () => {
    expect(toPerception(read('The build finished at four.'), []).emotion).toBeNull();
  });

  it('does not pass a merely possible emotion as a confident one', () => {
    // `possible` is capped well below `observed`, so the distinction survives as
    // a number even where Core has no word for it.
    const implied = toPerception(read('I guess nothing works.'), []);
    const stated = toPerception(read('I am frustrated.'), []);

    expect(implied.emotion).toBeNull();
    expect(stated.emotion?.confidence).toBeGreaterThan(0.6);
  });

  it('always gives Core an intent for a non-empty message', () => {
    const perception = toPerception(
      perceive({ percepts: [said('The build finished at four.')], at: at(0) }),
      [said('The build finished at four.')],
    );

    expect(perception.intents.length).toBeGreaterThan(0);
  });

  it('keeps the full picture on the outcome the projection discards', () => {
    const outcome = perceive({
      percepts: [said('I am so happy it finally works, but I am exhausted.')],
      at: at(0),
    });
    const perception = toPerception(outcome, []);

    // Core gets one emotion; both are still there for anyone who wants them.
    expect(perception.emotion).not.toBeNull();
    expect(stanceFor(outcome, 'joy')).toBe('observed');
    expect(stanceFor(outcome, 'fatigue')).toBe('observed');
  });
});
