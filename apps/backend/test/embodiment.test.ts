import { describe, expect, it } from 'vitest';
import { FixedClock } from '@nexa/shared';
import { ScriptedLanguageModel } from '@nexa/providers';
import type { LanguageModelPort } from '@nexa/core';
import { compose } from '../dist/composition.js';
import { buildServer } from '../dist/server.js';
import type { AppConfig } from '../dist/config.js';
import { TEST_JWT_SECRET, authHeaders, bindingsFor } from './support/auth.js';

/**
 * The action feedback loop, end to end over the real graph.
 *
 * This is the test that would have been impossible to write before this phase,
 * and the reason the phase existed. The backend generated actions and shipped
 * them; nothing came back. The only thing that knew whether Nexa had moved was
 * the Unity process, and the only thing writing the sentence about it was a
 * language model with no access to that process — so "did you move?" was
 * answered by whatever usually follows being asked to move.
 *
 * What is asserted here is not that Nexa says the right words. It is that the
 * *fact* reaches her: an outcome posted to `/v1/action-result` is in the next
 * turn's assembled context, marked as a failure, with the reason intact. What
 * she does with a fact is generation's business and a scripted model cannot
 * demonstrate it; that the fact arrives at all is what makes the honest
 * sentence possible rather than lucky.
 */

const config: AppConfig = {
  host: '127.0.0.1',
  port: 0,
  logLevel: 'silent',
  provider: 'scripted',
  modelId: 'scripted',
  anthropicApiKey: null,
  groqApiKey: null,
  providerTimeoutMs: 30_000,
  databaseUrl: null,
  openAiApiKey: null,
  embeddingModel: 'text-embedding-3-small',
  embeddingDimensions: 1536,
  supabaseJwtSecret: TEST_JWT_SECRET,
  deviceTokenSecret: null,
};

const COMPANION = 'companion-1';
const USER = 'user-1';

/**
 * Authenticated, because the API now requires it.
 *
 * These suites predate authentication and posted their identifiers in the body.
 * Rather than bypass the boundary they authenticate through it, with a real
 * token the production verifier checks — so what they exercise is the same path
 * a client takes.
 */
const AUTH = await authHeaders(USER);
const BINDINGS = () => bindingsFor(COMPANION as never, [USER as never]);

const harness = (responses: readonly string[] = []) => {
  const app = compose(config, {
    bindings: BINDINGS(),
    clock: new FixedClock(new Date('2026-07-29T12:00:00.000Z')),
    languageModel: new ScriptedLanguageModel(responses),
  });
  return { app, server: buildServer(app, config) };
};

/** An embodied client, declared the way the Unity client declares itself. */
const embodiedTurn = (text: string) => ({
  method: 'POST' as const,
  url: '/v1/turn',
  headers: AUTH,
  payload: {
    companionId: COMPANION,
    userId: USER,
    text,
    clientCapabilities: {
      actions: ['speak', 'move', 'follow', 'stop', 'look', 'gesture'],
      streaming: false,
      speechOutput: true,
    },
  },
});

interface OutcomeEntry {
  readonly actionId: string;
  readonly actionType: string;
  readonly status: string;
  readonly reason?: string;
  readonly detail?: string;
  readonly durationMs?: number;
  readonly at?: string;
}

const result = (outcomes: readonly OutcomeEntry[], extra: Record<string, unknown> = {}) => ({
  method: 'POST' as const,
  url: '/v1/action-result',
  headers: AUTH,
  payload: { companionId: COMPANION, userId: USER, outcomes, ...extra },
});

interface AcceptedBody {
  readonly accepted: number;
  readonly rejected: readonly string[];
}

describe('POST /v1/action-result', () => {
  it('accepts a reported outcome', async () => {
    const { server } = harness();

    const response = await server.inject(
      result([
        { actionId: 'action-1', actionType: 'move', status: 'failed', reason: 'blocked' },
      ]),
    );

    expect(response.statusCode).toBe(202);
    expect(response.json<AcceptedBody>().accepted).toBe(1);
  });

  it('refuses a batch with no companion or user', async () => {
    const { server } = harness();

    const response = await server.inject({
      method: 'POST',
      url: '/v1/action-result',
      headers: AUTH,
      payload: { outcomes: [{ actionId: 'a', actionType: 'move', status: 'completed' }] },
    });

    expect(response.statusCode).toBe(400);
  });

  it('records the readable outcomes in a batch and reports the rest', async () => {
    const { server } = harness();

    // A batch in which one entry is malformed still records the others. The
    // client has no way to resend, so dropping the batch would lose exactly the
    // evidence the companion needs.
    const response = await server.inject(
      result([
        { actionId: 'action-1', actionType: 'move', status: 'completed' },
        { actionId: 'action-2', actionType: 'nonsense', status: 'completed' },
      ]),
    );

    expect(response.statusCode).toBe(202);
    const body = response.json<AcceptedBody>();
    expect(body.accepted).toBe(1);
    expect(body.rejected).toHaveLength(1);
  });

  it('rejects a batch in which nothing could be read', async () => {
    const { server } = harness();

    const response = await server.inject(
      result([{ actionId: 'action-1', actionType: 'move', status: 'invented' }]),
    );

    expect(response.statusCode).toBe(400);
  });

  it('forces a reason onto a failure the client did not classify', async () => {
    const { app, server } = harness();

    await server.inject(
      result([{ actionId: 'action-1', actionType: 'move', status: 'failed' }]),
    );

    // `ActionOutcome`'s invariant — a reason exactly when the status is not
    // `completed` — must hold for anything that reaches the store, whatever the
    // client sent.
    const body = app.cognition.embodiment.snapshot(COMPANION as never);
    expect(body?.recentOutcomes[0]?.reason).toBe('unknown');
  });

  it('accepts a client clock with more precision than the domain uses', async () => {
    const { app, server } = harness();

    // .NET's round-trip format emits seven fractional digits; this domain's
    // Timestamp requires exactly three and *throws* on anything else. Passing the
    // raw string through turned a real Unity client into a 500 that took the whole
    // batch down with it — including outcomes that were perfectly readable.
    const response = await server.inject(
      result([
        {
          actionId: 'a1',
          actionType: 'move',
          status: 'completed',
          at: '2026-08-29T11:21:02.6868479Z',
        },
      ]),
    );

    expect(response.statusCode).toBe(202);
    const body = app.cognition.embodiment.snapshot(COMPANION as never);
    expect(body?.recentOutcomes[0]?.at).toBe('2026-08-29T11:21:02.686Z');
  });

  it('falls back to its own clock when the client sends an unreadable time', async () => {
    const { server } = harness();

    const response = await server.inject(
      result([
        { actionId: 'a1', actionType: 'move', status: 'completed', at: 'not-a-time' },
      ]),
    );

    // The report survives. A body reporting a real outcome must never be rejected
    // over the shape of its clock.
    expect(response.statusCode).toBe(202);
  });

  it('strips a reason from a success', async () => {
    const { app, server } = harness();

    await server.inject(
      result([
        { actionId: 'a', actionType: 'move', status: 'completed', reason: 'blocked' },
      ]),
    );

    const body = app.cognition.embodiment.snapshot(COMPANION as never);
    expect(body?.recentOutcomes[0]?.reason).toBeNull();
  });
});

describe('the loop closes', () => {
  it('puts a reported failure into the next turn assembled context', async () => {
    const { app, server } = harness(['On my way.', 'Sorry about that.']);

    // 1. A turn that produces a move.
    await server.inject(embodiedTurn('Nexa, come here.'));

    // 2. The body reports that it could not.
    await server.inject(
      result(
        [
          {
            actionId: 'action-1',
            actionType: 'move',
            status: 'failed',
            reason: 'blocked',
            detail: 'a chair is in the way',
            durationMs: 1200,
          },
        ],
        { activity: 'idle', canPerform: ['move', 'look', 'gesture'] },
      ),
    );

    // 3. The failure is now a fact the companion holds, not a guess it makes.
    const body = app.cognition.embodiment.snapshot(COMPANION as never);
    expect(body?.recentOutcomes).toHaveLength(1);
    expect(body?.recentOutcomes[0]).toMatchObject({
      actionType: 'move',
      status: 'failed',
      reason: 'blocked',
      detail: 'a chair is in the way',
    });

    // 4. And it reaches the next turn's context through the embodiment port,
    //    which is the whole claim: the model is told what happened rather than
    //    asked to remember what it intended.
    const second = await server.inject(embodiedTurn('Did you make it over?'));
    expect(second.statusCode).toBe(200);
  });

  it('latches following on a completed follow, and releases it on a stop', async () => {
    const { app, server } = harness();

    // A follow completes when the behaviour *starts*, not when it ends — it is
    // a latched state, which is what keeps the executor's queue from being
    // wedged forever by an action that never finishes.
    await server.inject(
      result([{ actionId: 'a1', actionType: 'follow', status: 'completed' }]),
    );
    expect(app.cognition.embodiment.snapshot(COMPANION as never)?.activity).toBe('following');

    await server.inject(
      result([{ actionId: 'a2', actionType: 'stop', status: 'completed' }]),
    );
    const after = app.cognition.embodiment.snapshot(COMPANION as never);
    expect(after?.activity).toBe('idle');
    expect(after?.following).toBeNull();
  });

  it('reports a body nothing has spoken for as unknown rather than idle', async () => {
    const { app } = harness();

    // The honest answer to a body that has never reported. Assuming `idle`
    // would be asserting a stillness nothing verified.
    expect(app.cognition.embodiment.snapshot(COMPANION as never)).toBeNull();
  });

  it('keeps the body scoped to the companion, not the user', async () => {
    const { app, server } = harness();

    await server.inject(
      result([{ actionId: 'a1', actionType: 'move', status: 'completed' }]),
    );

    // One companion has one body, and two people talking to it are looking at
    // the same character. Keying on the user would give each of them a private,
    // contradictory belief about where one physical thing is standing.
    await server.inject({
      method: 'POST',
      url: '/v1/action-result',
      headers: AUTH,
      payload: {
        companionId: COMPANION,
        userId: 'user-2',
        outcomes: [{ actionId: 'a2', actionType: 'move', status: 'failed', reason: 'blocked' }],
      },
    });

    const body = app.cognition.embodiment.snapshot(COMPANION as never);
    expect(body?.recentOutcomes).toHaveLength(2);
  });
});

/**
 * A model that records the system prompt it was handed.
 *
 * The only way to assert the *whole* loop rather than its first two thirds. The
 * store holding an outcome proves the report was received; this proves it
 * reached the one place that could make the companion lie about it.
 */
const capturingModel = (reply: string) => {
  const prompts: string[] = [];

  const model: LanguageModelPort = {
    name: 'capturing',
    capabilities: {
      toolUse: false,
      streaming: false,
      contextWindow: 128_000,
      promptCaching: false,
    },
    complete: async (request) => {
      prompts.push(request.system);
      return {
        ok: true as const,
        value: {
          text: reply,
          inputTokens: 10,
          outputTokens: 10,
          cachedInputTokens: 0,
          model: 'capturing',
          refused: false,
          toolCalls: [],
        },
      };
    },
  };

  return { model, prompts };
};

describe('the reported outcome reaches the model', () => {
  it('puts a blocked move into the next prompt as a fact, not a guess', async () => {
    const { model, prompts } = capturingModel('Sorry about that.');
    const app = compose(config, {
    bindings: BINDINGS(),
      clock: new FixedClock(new Date('2026-07-29T12:00:00.000Z')),
      languageModel: model,
    });
    const server = buildServer(app, config);

    await server.inject(
      result([
        {
          actionId: 'action-1',
          actionType: 'move',
          status: 'failed',
          reason: 'blocked',
          detail: 'a chair is in the way',
          durationMs: 1200,
        },
      ]),
    );

    await server.inject(embodiedTurn('Did you make it over?'));

    const prompt = prompts.at(-1) ?? '';

    // The whole point of the phase, in four assertions: the model is *told*
    // what happened, told it failed, told why, and told in as many words that
    // it did not do the thing. None of this was reachable before — the only
    // component that knew was the client, and nothing carried it back.
    expect(prompt).toContain('FAILED');
    expect(prompt).toContain('something was in the way');
    expect(prompt).toContain('a chair is in the way');
    expect(prompt).toContain('You did not do it.');

    await app.shutdown();
  });

  it('never tells an unembodied client it has a body', async () => {
    const { model, prompts } = capturingModel('Hello.');
    const app = compose(config, {
    bindings: BINDINGS(),
      clock: new FixedClock(new Date('2026-07-29T12:00:00.000Z')),
      languageModel: model,
    });
    const server = buildServer(app, config);

    await server.inject({
      method: 'POST',
      url: '/v1/turn',
      headers: AUTH,
      payload: { companionId: COMPANION, userId: USER, text: 'Hello.' },
    });

    const prompt = prompts.at(-1) ?? '';

    expect(prompt).not.toContain('```nexa');
    expect(prompt).toContain('Cannot move, touch, or change anything in the physical world.');

    await app.shutdown();
  });

  it('describes only the body actions the client declared', async () => {
    const { model, prompts } = capturingModel('Okay.');
    const app = compose(config, {
    bindings: BINDINGS(),
      clock: new FixedClock(new Date('2026-07-29T12:00:00.000Z')),
      languageModel: model,
    });
    const server = buildServer(app, config);

    await server.inject({
      method: 'POST',
      url: '/v1/turn',
      headers: AUTH,
      payload: {
        companionId: COMPANION,
        userId: USER,
        text: 'Come here.',
        clientCapabilities: { actions: ['speak', 'move'], streaming: false },
      },
    });

    const prompt = prompts.at(-1) ?? '';

    // A client that cannot gesture is never told gestures exist. This is the
    // gap that used to produce capability hallucination: the old prompt said
    // "you have a physical presence" and named exactly one verb, leaving the
    // boundary entirely unstated.
    expect(prompt).toContain('"type":"move"');
    expect(prompt).not.toContain('"type":"gesture"');
    expect(prompt).not.toContain('"type":"follow"');

    await app.shutdown();
  });
});
