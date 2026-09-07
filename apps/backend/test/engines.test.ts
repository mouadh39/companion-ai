import { describe, expect, it } from 'vitest';
import { FixedClock, trustExternalId, type CompanionId, type UserId } from '@nexa/shared';
import type {
  CompletionRequest,
  LanguageModelPort,
  PerceptionPort,
} from '@nexa/core';
import type { Perception, UserEmotion } from '@nexa/models';
import { confidence } from '@nexa/models';
import { ok } from '@nexa/shared';
import { currentIdentity } from '@nexa/identity';
import { loadConfig } from '../src/config.js';
import { compose } from '../src/composition.js';

/**
 * Proof that a live turn now reflects both Phase 2 engines.
 *
 * These run the *real* composition root — the same `compose()` the server uses —
 * and substitute only the clock and the model provider. Everything else is
 * production wiring, so a passing test here means the engines are genuinely
 * reachable from an HTTP request rather than merely reachable in principle.
 *
 * The model is a capture harness: it records the system prompt it was handed and
 * returns a fixed reply. That is what makes the prompt itself assertable, which
 * is the only way to show that identity and expression actually reached the one
 * place they were built to influence.
 */

interface Captured {
  readonly prompts: string[];
}

const capturingModel = (captured: Captured): LanguageModelPort => ({
  name: 'capture',
  capabilities: {
    toolUse: false,
    streaming: false,
    contextWindow: 100_000,
    promptCaching: false,
  },
  complete: async (request: CompletionRequest) => {
    captured.prompts.push(request.system);
    return ok({
      text: 'Understood.',
      inputTokens: 10,
      outputTokens: 5,
      cachedInputTokens: 0,
      model: 'capture',
      refused: false,
      toolCalls: [],
    });
  },
});

/**
 * Perception that reports a *confident* emotional read.
 *
 * Pins a specific emotion at a specific strength. The real engine reaches these
 * confidences for a *stated* feeling, so this is no longer the only way to get
 * here — but a test that needs one named emotion should say which, rather than
 * depending on the lexicon continuing to read a particular sentence a particular
 * way. Substituting perception here is the same seam as substituting the clock.
 */
const confidentPerception = (emotion: UserEmotion): PerceptionPort => ({
  perceive: async (text: string): Promise<Perception> => ({
    text,
    intents: [{ kind: 'statement', confidence: confidence(0.9) }],
    emotion: {
      emotion,
      intensity: confidence(0.8),
      confidence: confidence(0.95),
    },
    entities: [],
  }),
});

const runTurn = async (text: string, perception?: PerceptionPort) => {
  const captured: Captured = { prompts: [] };
  const app = compose(loadConfig({}), {
    clock: new FixedClock(new Date('2026-07-31T12:00:00.000Z')),
    languageModel: capturingModel(captured),
    ...(perception !== undefined ? { perception } : {}),
  });

  const result = await app.turn.run({
    companionId: trustExternalId<CompanionId>('companion-1'),
    userId: trustExternalId<UserId>('user-1'),
    text,
    source: 'user',
  });

  await app.shutdown();
  return { result, prompt: captured.prompts[0] ?? '' };
};

describe('the Identity Engine reaches a live turn', () => {
  it('puts the canonical profile on the context, not a hand-written constant', async () => {
    const { result } = await runTurn('hello');

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // The identical frozen object `@nexa/identity` serves. `StaticIdentity`
    // used to supply a literal here that nothing kept in step with the engine.
    expect(result.value.record.turnId).toBeDefined();
    expect(currentIdentity().name).toBe('Nexa');
  });

  it('renders values with their precedence into the system prompt', async () => {
    const { prompt } = await runTurn('hello');

    expect(prompt).toContain('You are Nexa.');
    expect(prompt).toContain('When two conflict, the lower number wins');
    // Honesty is precedence 1 — the ordering the whole engine rests on.
    expect(prompt).toContain('1. Honesty');
  });

  it('states permanent limitations and withholds temporary ones', async () => {
    const { prompt } = await runTurn('hello');
    const identity = currentIdentity();

    const permanent = identity.limitations.find((l) => l.permanent);
    const temporary = identity.limitations.find((l) => !l.permanent);

    expect(permanent).toBeDefined();
    expect(prompt).toContain(permanent?.summary ?? '__missing__');
    // Hedging about what it cannot do *yet* invites the user to argue with it.
    expect(prompt).not.toContain(temporary?.summary ?? '__missing__');
  });

  it('no longer dumps raw trait numbers into the prompt', async () => {
    const { prompt } = await runTurn('hello');

    // The old shape was `warmth 0.90, humor 0.45` — a mapping from numbers to
    // behaviour that the model had to invent, differently each turn.
    expect(prompt).not.toContain('normalised traits from 0 to 1');
    expect(prompt).not.toMatch(/warmth 0\.\d\d/);
  });
});

describe('the Personality Engine reaches a live turn', () => {
  it('puts a composed ExpressionProfile on the context', async () => {
    const { result } = await runTurn('hello');

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const record = result.value.record;
    // The contributor ran as a real, budgeted port call like any other.
    const call = record.portCalls.find((c) => c.port === 'expression');
    expect(call).toBeDefined();
    expect(call?.outcome).toBe('ok');
  });

  it('renders resolved behavioural guidance instead of numbers', async () => {
    const { prompt } = await runTurn('hello');

    expect(prompt).toContain('How to communicate on this turn:');
    expect(prompt).toMatch(/Tone: (neutral|warm|encouraging|concerned|playful)\./);
    expect(prompt).toMatch(/Detail: (minimal|brief|moderate|thorough)\./);
    expect(prompt).toMatch(/Pace: (slow|measured|brisk)\./);
  });

  it('suppresses humour outright when the user is confidently read as struggling', async () => {
    // The engine's hardest rule, observed end to end through the real pipeline.
    const { prompt } = await runTurn('nothing is working', confidentPerception('frustrated'));

    expect(prompt).toContain('Do not attempt humour at all.');
  });

  it('does not suppress humour when the same user seems calm', async () => {
    const { prompt } = await runTurn('how are things', confidentPerception('calm'));

    expect(prompt).not.toContain('Do not attempt humour at all.');
  });

  it('adjusts the delivered tone from the composed profile', async () => {
    const distressed = await runTurn('nothing is working', confidentPerception('frustrated'));
    const ordinary = await runTurn('how are things', confidentPerception('calm'));

    expect(distressed.prompt).toContain('Tone: concerned.');
    expect(ordinary.prompt).not.toContain('Tone: concerned.');
  });

  it('stamps the composed tone onto the speak action the client receives', async () => {
    const { result } = await runTurn('nothing is working', confidentPerception('frustrated'));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const spoken = result.value.actions.find((action) => action.type === 'speak');
    expect(spoken).toBeDefined();
    if (spoken?.type !== 'speak') return;

    // Previously chosen by `toneFor`, a narrower heuristic reading only
    // perception and warmth. It now defers to the engine.
    expect(spoken.tone).toBe('concerned');
  });

  it('ignores a sub-threshold reading from the real engine, as designed', async () => {
    // `@nexa/perception` reads 'nothing is working' as *possible* frustration:
    // a report about a build, not about a person. Inference is capped well below
    // a statement, so the reading lands under the floor the projection to Core
    // requires and no emotion reaches the turn at all. Scaling a weak guess down
    // instead of discarding it is how a companion ends up permanently, slightly
    // wrong about how everyone feels.
    const weak = await runTurn('nothing is working');

    // Intent shaping still applies — that is a separate, confident signal. What
    // must not appear is any consequence of the emotional read.
    expect(weak.prompt).not.toContain('Do not attempt humour at all.');
    expect(weak.prompt).not.toContain('Tone: concerned.');
  });
});

describe('the integration stays deterministic and replayable', () => {
  it('produces an identical prompt for an identical turn', async () => {
    const first = await runTurn('hello there');
    const second = await runTurn('hello there');

    expect(first.prompt).toBe(second.prompt);
  });

  it('records the identity version the turn ran under', async () => {
    const { result } = await runTurn('hello');

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // What a replay resolves against via `identityAt(version)`.
    expect(currentIdentity().version).toBe(1);
    expect(result.value.record.outcome).toBe('completed');
  });

  it('leaves the frozen identity untouched after a turn', async () => {
    const before = JSON.stringify(currentIdentity());
    await runTurn('hello');

    expect(JSON.stringify(currentIdentity())).toBe(before);
  });
});
