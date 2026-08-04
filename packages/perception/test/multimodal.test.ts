import { describe, expect, it } from 'vitest';
import type { Percept } from '@nexa/models';
import { PERCEPT_CHANNELS } from '@nexa/models';
import {
  DEFAULT_CONFIG,
  POSSIBLE_CEILING,
  asChannel,
  availableDimensions,
  perceive,
  reachableDimensions,
  stanceFor,
} from '@nexa/perception';
import type { SignalExtractor } from '@nexa/perception';
import { allOn, at, on, read, said, unknownFor } from './fixtures.js';

/**
 * A voice channel, invented entirely in this test file.
 *
 * This is the load-bearing test of the whole architecture. Nothing in `src/`
 * knows this exists, and adding it required no change to the observation model,
 * the confidence model, the stance rule, the unknown reporting or the pass. If
 * a future prosody, face or gaze channel needs anything more than what happens
 * here, the extension seam has failed and this test is where it should show.
 */
interface VoicePercept extends Percept {
  readonly channel: 'voice';
  /** 0–1. How strained the voice sounded. */
  readonly strain: number;
  /** 0–1. How fast they were speaking. */
  readonly pace: number;
}

const heard = (strain: number, pace = 0.5): VoicePercept => ({
  channel: 'voice',
  at: at(0),
  strain,
  pace,
});

const voiceExtractor: SignalExtractor = {
  id: 'voice.prosody',
  channel: 'voice',
  dimensions: ['frustration', 'urgency', 'calm'],
  extract: (percept) => {
    const voice = asChannel<VoicePercept>(percept, 'voice');
    if (voice === null) return [];

    const signals = [];
    if (voice.strain > 0.6) {
      signals.push({
        dimension: 'frustration' as const,
        // Inferred about the person, exactly as a hedged phrase is. A raised
        // voice is not a statement about how someone feels.
        stance: 'possible' as const,
        magnitude: voice.strain,
        evidence: [
          {
            kind: 'signal' as const,
            channel: 'voice' as const,
            cue: 'vocal_strain',
            excerpt: '',
            strength: 0.55,
          },
        ],
      });
    }
    if (voice.pace > 0.7) {
      signals.push({
        dimension: 'urgency' as const,
        stance: 'possible' as const,
        magnitude: voice.pace,
        evidence: [
          {
            kind: 'signal' as const,
            channel: 'voice' as const,
            cue: 'speech_rate',
            excerpt: '',
            strength: 0.5,
          },
        ],
      });
    }
    return signals;
  },
};

const withVoice = { ...DEFAULT_CONFIG, extractors: [...DEFAULT_CONFIG.extractors, voiceExtractor] };

describe('a new channel needs no change to the architecture', () => {
  it('produces observations through the same model', () => {
    const outcome = perceive({
      percepts: [said('It is fine.'), heard(0.8)],
      at: at(0),
      config: withVoice,
    });

    expect(stanceFor(outcome, 'frustration')).toBe('possible');
    expect(on(outcome, 'frustration')?.channel).toBe('voice');
  });

  it('obeys the same stance ceiling as text', () => {
    const outcome = perceive({
      percepts: [heard(1)],
      at: at(0),
      config: withVoice,
    });

    expect(on(outcome, 'frustration')?.confidence).toBeLessThanOrEqual(POSSIBLE_CEILING);
  });

  it('reports which channel saw what', () => {
    const outcome = perceive({
      percepts: [said('THIS IS URGENT!!'), heard(0.2, 0.9)],
      at: at(0),
      config: withVoice,
    });

    // Three readings, not two: the text channel reports stated urgency and
    // typographic urgency separately, and the voice channel adds its own.
    const urgency = allOn(outcome, 'urgency');
    expect(new Set(urgency.map((observation) => observation.channel))).toStrictEqual(
      new Set(['text', 'voice']),
    );
    expect(urgency.filter((observation) => observation.channel === 'voice')).toHaveLength(1);
    expect([...outcome.channels].sort()).toStrictEqual(['text', 'voice']);
  });
});

describe('channels never merge', () => {
  it('keeps two agreeing channels as two observations', () => {
    // Fusing them into one stronger reading is the borrowing the engine
    // forbids, arriving through the multimodal door.
    const outcome = perceive({
      percepts: [said('This is so frustrating.'), heard(0.9)],
      at: at(0),
      config: withVoice,
    });

    expect(allOn(outcome, 'frustration')).toHaveLength(2);
  });

  it('does not let a second channel raise the first’s confidence', () => {
    const textOnly = perceive({
      percepts: [said('This is so frustrating.')],
      at: at(0),
      config: withVoice,
    });
    const both = perceive({
      percepts: [said('This is so frustrating.'), heard(0.9)],
      at: at(0),
      config: withVoice,
    });

    const alone = textOnly.observations.find(
      (observation) => observation.dimension === 'frustration' && observation.channel === 'text',
    );
    const beside = both.observations.find(
      (observation) => observation.dimension === 'frustration' && observation.channel === 'text',
    );

    expect(beside?.confidence).toBe(alone?.confidence);
  });

  it('does not let a contradicting channel lower it either', () => {
    const alone = on(read('I am frustrated.'), 'frustration');
    const contradicted = perceive({
      percepts: [said('I am frustrated.'), heard(0.1)],
      at: at(0),
      config: withVoice,
    }).observations.find(
      (observation) => observation.dimension === 'frustration' && observation.channel === 'text',
    );

    expect(contradicted?.confidence).toBe(alone?.confidence);
  });
});

describe('what a deployment cannot see, it says it cannot see', () => {
  it('reports a dimension with no channel differently from one with no evidence', () => {
    // A companion without a microphone must not be told the voice was calm.
    const textOnly = read('The build finished.');

    expect(unknownFor(textOnly, 'frustration')?.reason).toBe('no_evidence');

    const noExtractors = perceive({
      percepts: [said('The build finished.')],
      at: at(0),
      config: { ...DEFAULT_CONFIG, extractors: [] },
    });
    expect(unknownFor(noExtractors, 'frustration')?.reason).toBe('no_channel');
  });

  it('ignores a percept nothing is registered to read, and says so', () => {
    // A client that sends camera frames to a deployment with no face extractor
    // should degrade, not fail a turn.
    const outcome = perceive({
      percepts: [said('Hello.'), heard(0.9)],
      at: at(0),
    });

    expect(outcome.observations.every((observation) => observation.channel === 'text')).toBe(true);
    expect(outcome.reasons.some((reason) => reason.code === 'no_extractor')).toBe(true);
  });

  it('knows which dimensions each set of extractors could ever reach', () => {
    const reachable = reachableDimensions(withVoice.extractors);
    expect(reachable.has('frustration')).toBe(true);

    const textOnly = availableDimensions(withVoice.extractors, new Set(['text']));
    const voiceOnly = availableDimensions(withVoice.extractors, new Set(['voice']));

    expect(voiceOnly.has('verbosity')).toBe(false);
    expect(textOnly.has('verbosity')).toBe(true);
  });
});

describe('the channel vocabulary is ready for them', () => {
  it('already names the channels that do not exist yet', () => {
    // Declared before anything produces them, so adding one is registering an
    // extractor rather than widening a union every consumer switches on.
    for (const channel of ['voice', 'face', 'gaze', 'body', 'sensor', 'interaction']) {
      expect(PERCEPT_CHANNELS).toContain(channel);
    }
  });
});
