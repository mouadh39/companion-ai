import { describe, expect, it } from 'vitest';
import { FixedClock } from '@nexa/shared';
import { ScriptedLanguageModel } from '@nexa/providers';
import { compose } from '../dist/composition.js';
import { buildServer } from '../dist/server.js';
import type { AppConfig } from '../dist/config.js';

/**
 * End-to-end over the real graph.
 *
 * The only substitutions are the clock and the model provider — everything
 * else is the production wiring. That is the point of a vertical slice: it
 * proves the seams hold under a real caller, while the cost of changing an
 * interface is still close to zero.
 */

/**
 * The wire shapes the endpoint returns.
 *
 * Declared here rather than imported: this is a test of the HTTP contract, and
 * typing it against the server's internal types would let a breaking change to
 * the response body pass unnoticed. Written out, the test fails to compile when
 * the contract moves — which is the point.
 *
 * They also give `response.json<T>()` something to return. Untyped it yields
 * `any`, which silently disables every downstream check in this file.
 */
interface TurnResponseBody {
  readonly actions: readonly {
    readonly type: string;
    readonly text?: string;
    readonly decisionId: string;
  }[];
  readonly decision: {
    readonly id: string;
    readonly kind: string;
    readonly confidence: number;
    readonly reasonCodes: readonly string[];
  };
  readonly degraded: boolean;
}

interface ErrorBody {
  readonly error: string;
}

interface HealthBody {
  readonly status: string;
  readonly model: string;
}

const config: AppConfig = {
  host: '127.0.0.1',
  port: 0,
  logLevel: 'silent',
  provider: 'scripted',
  modelId: 'scripted',
  anthropicApiKey: null,
};

const harness = (responses: readonly string[] = []) => {
  const app = compose(config, {
    clock: new FixedClock(new Date('2026-07-29T12:00:00.000Z')),
    languageModel: new ScriptedLanguageModel(responses),
  });
  return { app, server: buildServer(app, config) };
};

const turn = (text: string) => ({
  method: 'POST' as const,
  url: '/v1/turn',
  payload: { companionId: 'companion-1', userId: 'user-1', text },
});

describe('POST /v1/turn', () => {
  it('answers a question with a speak action', async () => {
    const { server } = harness(['Anchors keep content welded to a real surface.']);

    const response = await server.inject(turn('How do anchors work?'));

    expect(response.statusCode).toBe(200);
    const body = response.json<TurnResponseBody>();
    expect(body.actions).toHaveLength(1);
    expect(body.actions[0]?.type).toBe('speak');
    expect(body.actions[0]?.text).toBe('Anchors keep content welded to a real surface.');
    expect(body.decision.kind).toBe('answer');
  });

  it('returns the decision alongside the actions, so any answer is accountable', async () => {
    const { server } = harness(['Sure.']);

    const body = (await server.inject(turn('Can you help me build this?'))).json<TurnResponseBody>();

    expect(body.decision.reasonCodes.length).toBeGreaterThan(0);
    expect(body.decision.confidence).toBeGreaterThan(0);
    expect(body.actions[0]?.decisionId).toBe(body.decision.id);
  });

  it('links every action back to the decision that produced it', async () => {
    const { server } = harness(["Understood — I'll remember that."]);

    const body = (await server.inject(turn("Actually, that's wrong — I use pnpm."))).json<TurnResponseBody>();

    expect(body.decision.kind).toBe('remember');
    for (const action of body.actions) {
      expect(action.decisionId).toBe(body.decision.id);
    }
    expect(body.actions.map((action) => action.type)).toContain('remember');
  });

  it('emits the turn lifecycle and decision events', async () => {
    const { app, server } = harness(['Hello.']);
    const seen: string[] = [];

    app.events.subscribe('nexa.turn.started', async () => void seen.push('started'));
    app.events.subscribe('nexa.decision.made', async () => void seen.push('decided'));
    app.events.subscribe('nexa.turn.completed', async () => void seen.push('completed'));

    await server.inject(turn('What is the plan for tomorrow?'));
    // Handlers are dispatched without being awaited by the publisher, which is
    // the contract; yield once so they run before asserting.
    await new Promise((resolve) => setImmediate(resolve));

    expect(seen).toEqual(['started', 'decided', 'completed']);
  });

  it('does not call an empty section a degradation', async () => {
    const { server } = harness(['Here is what I know.']);

    const body = (await server.inject(turn('How do anchors work?'))).json<TurnResponseBody>();

    // There is no memory store yet, so retrieval, goals and tools are all
    // legitimately empty. That is not degradation: nothing was lost, there was
    // simply nothing to lose. Counting it would pin `degraded` at true on every
    // turn and make the signal useless for the case it exists to catch — a
    // section that *should* have arrived and did not.
    //
    // `@nexa/core`'s `assembler-graph.test.ts` covers the other side: a port
    // that fails does mark the turn degraded.
    expect(body.degraded).toBe(false);
    expect(body.actions.some((action) => action.type === 'speak')).toBe(true);
  });

  it('rejects a request with no text', async () => {
    const { server } = harness();

    const response = await server.inject({
      method: 'POST',
      url: '/v1/turn',
      payload: { companionId: 'companion-1', userId: 'user-1' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json<ErrorBody>().error).toBe('invalid_request');
  });

  it('rejects a request missing identity', async () => {
    const { server } = harness();

    const response = await server.inject({
      method: 'POST',
      url: '/v1/turn',
      payload: { text: 'hello' },
    });

    expect(response.statusCode).toBe(400);
  });

  it('carries conversation history across turns', async () => {
    const { server } = harness(['First.', 'Second.']);

    await server.inject(turn('My name is Mouadh.'));
    const second = (await server.inject(turn('What did I just tell you?'))).json<TurnResponseBody>();

    expect(second.actions[0]?.text).toBe('Second.');
    expect(second.decision.kind).toBe('answer');
  });

  it('serves health without touching the provider', async () => {
    const { server } = harness();

    const body = (await server.inject({ method: 'GET', url: '/health' })).json<HealthBody>();

    expect(body.status).toBe('ok');
    expect(body.model).toBe('scripted');
  });
});
