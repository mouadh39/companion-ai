import { describe, expect, it } from 'vitest';
import { FixedClock, trustExternalId, type CompanionId, type UserId } from '@nexa/shared';
import { ScriptedLanguageModel } from '@nexa/providers';
import { capabilityOf, type ClientCapabilities } from '@nexa/models';
import { currentIdentity } from '@nexa/identity';
import { Deadline, type LanguageModelPort, type PortOptions } from '@nexa/core';
import { compose } from '../dist/composition.js';
import { buildServer } from '../dist/server.js';
import type { AppConfig } from '../dist/config.js';
import { TEST_JWT_SECRET, authHeaders, bindingsFor } from './support/auth.js';

/**
 * The Self Model, wired into the real graph.
 *
 * `@nexa/self` is unit-tested against synthetic inputs; what these assert is
 * that the *pipeline* runs it and hands it the right ones — the identity that
 * was loaded, the body the action-result loop actually recorded, and this
 * session's client declaration. A resolver given the wrong inputs resolves
 * confidently and wrongly, which is the failure unit tests cannot see.
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

const COMPANION = trustExternalId<CompanionId>('companion-1');
const USER = trustExternalId<UserId>('user-1');

/**
 * Authenticated, because the API now requires it.
 *
 * These suites predate authentication and posted their identifiers in the body.
 * Rather than bypass the boundary they authenticate through it, with a real
 * token the production verifier checks — so what they exercise is the same path
 * a client takes.
 */
const AUTH = await authHeaders(USER);
const BINDINGS = () => bindingsFor(COMPANION, [USER]);

const clock = new FixedClock(new Date('2026-07-29T12:00:00.000Z'));

const harness = () => {
  const app = compose(config, {
    bindings: BINDINGS(),
    clock,
    languageModel: new ScriptedLanguageModel(['Sure.', 'Sure.', 'Sure.']),
  });
  return { app, server: buildServer(app, config) };
};

const EMBODIED: ClientCapabilities = {
  actions: ['speak', 'move', 'follow', 'stop', 'look', 'gesture'],
  streaming: false,
  locale: null,
};

const options = (): PortOptions => ({
  signal: new AbortController().signal,
  deadline: Deadline.after(clock, 5_000),
  turnId: trustExternalId('turn-1'),
});

const outcome = (over: Record<string, unknown> = {}) => ({
  method: 'POST' as const,
  url: '/v1/action-result',
  headers: AUTH,
  payload: {
    companionId: COMPANION,
    userId: USER,
    outcomes: [{ actionId: 'a1', actionType: 'move', status: 'completed' }],
    ...over,
  },
});

/** Resolves through the real adapter, against the real body store. */
const resolve = async (
  app: ReturnType<typeof compose>,
  client: ClientCapabilities | null = EMBODIED,
) =>
  app.cognition.selfModel.resolve(
    {
      companionId: COMPANION,
      identity: currentIdentity(),
      body: app.cognition.embodiment.snapshot(COMPANION),
      clientCapabilities: client,
    },
    options(),
  );

describe('the SELF contributor runs in the pipeline', () => {
  it('is called during assembly, and succeeds', async () => {
    const { app } = harness();

    const result = await app.turn.run({
      companionId: COMPANION,
      userId: USER,
      text: 'Hello.',
      source: 'user',
      clientCapabilities: EMBODIED,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Proof the contributor is wired and ran, rather than being declared and
    // never scheduled — which is exactly what a dependency added to the wrong
    // wave looks like from outside.
    const call = result.value.record.portCalls.find((entry) => entry.port === 'self');
    expect(call).toBeDefined();
    expect(call?.outcome).toBe('ok');

    await app.shutdown();
  });

  it('leaves the existing contributor set otherwise untouched', async () => {
    const { app } = harness();

    const result = await app.turn.run({
      companionId: COMPANION,
      userId: USER,
      text: 'Hello.',
      source: 'user',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // The Phase 1–5 contributors must all still be called. Adding a dependent
    // must not have displaced anything.
    const ports = result.value.record.portCalls.map((entry) => entry.port);
    for (const expected of ['identity', 'personality', 'working_memory', 'body']) {
      expect(ports).toContain(expected);
    }

    await app.shutdown();
  });
});

describe('the resolver receives the right inputs', () => {
  it('resolves against the identity that was loaded, by reference', async () => {
    const { app } = harness();
    const self = await resolve(app);

    expect(self.identity).toBe(currentIdentity());
    expect(self.identity.name).toBe('Nexa');

    await app.shutdown();
  });

  it('reports the body the action-result loop recorded', async () => {
    const { app, server } = harness();
    await server.inject(
      outcome({ activity: 'idle', canPerform: ['move', 'look', 'gesture', 'follow', 'stop'] }),
    );

    const self = await resolve(app);
    expect(self.body?.canPerform).toContain('move');
    expect(capabilityOf(self, 'walk')).toMatchObject({ status: 'available' });

    await app.shutdown();
  });

  it('says walking is unknown while the body has never reported', async () => {
    // The honest answer. A body that has said nothing has said nothing, and
    // assuming either way is what the Self Model exists to stop.
    const { app } = harness();
    const self = await resolve(app);

    expect(capabilityOf(self, 'walk')).toMatchObject({
      status: 'unknown',
      reason: 'no_report',
    });

    await app.shutdown();
  });

  it('says gesture is unsupported for a client that cannot render it', async () => {
    const { app, server } = harness();
    await server.inject(outcome({ activity: 'idle', canPerform: ['move'] }));

    const self = await resolve(app, { ...EMBODIED, actions: ['speak'] });
    expect(capabilityOf(self, 'gesture')).toMatchObject({
      status: 'unsupported',
      reason: 'client_cannot_render',
    });

    await app.shutdown();
  });

  it('says gesture needs a skill when the body lacks the clip', async () => {
    const { app, server } = harness();
    await server.inject(outcome({ activity: 'idle', canPerform: ['move', 'look'] }));

    const self = await resolve(app);
    expect(capabilityOf(self, 'gesture')).toMatchObject({
      status: 'unsupported',
      reason: 'body_cannot_perform',
      recovery: 'acquire_skill',
    });

    await app.shutdown();
  });
});

describe('faculty resolution reflects what was actually composed', () => {
  it('reports vision as not built, ahead of any device question', async () => {
    const { app } = harness();
    const self = await resolve(app);

    // Nothing implements vision, so resolution never reaches the camera check.
    // Reporting "no camera" would send someone to buy hardware for a feature
    // that does not exist.
    expect(capabilityOf(self, 'see')).toMatchObject({
      status: 'unavailable',
      reason: 'not_built',
      recovery: 'develop',
    });

    await app.shutdown();
  });

  it('reports long-term recall as available, because retrieval is composed', async () => {
    const { app } = harness();
    const self = await resolve(app);

    expect(capabilityOf(self, 'long_term_recall')).toMatchObject({ status: 'available' });

    await app.shutdown();
  });

  it('does not claim speech faculties this process does not have', async () => {
    // Recognition and synthesis live entirely in the client. This process
    // neither performs nor verifies them, so claiming them would be the backend
    // asserting a faculty it does not have.
    const { app } = harness();
    const self = await resolve(app);

    expect(capabilityOf(self, 'speak_aloud')?.status).not.toBe('available');
    expect(capabilityOf(self, 'hear_speech')?.status).not.toBe('available');

    await app.shutdown();
  });
});

describe('the Self Model stays separate from user data', () => {
  it('carries no memories and no user, and is identical across users', async () => {
    const { app, server } = harness();

    await server.inject({
      method: 'POST',
      url: '/v1/turn',
      headers: AUTH,
      payload: { companionId: COMPANION, userId: 'user-a', text: 'My name is Mourez.' },
    });

    const self = await resolve(app);

    // Identity is a frozen constant with no write path. Nothing a user says
    // reaches it, and the state carries no user scope at all.
    expect(self.identity.name).toBe('Nexa');
    expect(JSON.stringify(self)).not.toContain('Mourez');
    expect(JSON.stringify(self)).not.toContain('user-a');

    await app.shutdown();
  });
});

/**
 * What the model is actually told, for the questions a person actually asks.
 *
 * The unit tests prove the section renders correctly from a `SelfState`; these
 * prove the *pipeline* puts a real one in front of the provider. A resolver
 * that works and a prompt that never receives it look identical from outside.
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
    complete: (request) => {
      prompts.push(request.system);
      return Promise.resolve({
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
      });
    },
  };

  return { model, prompts };
};

const capturingHarness = () => {
  const { model, prompts } = capturingModel('Sure.');
  const app = compose(config, {
    bindings: BINDINGS(), clock, languageModel: model });
  return { app, server: buildServer(app, config), prompts };
};

const ask = async (
  server: ReturnType<typeof buildServer>,
  text: string,
  actions: readonly string[] = ['speak', 'move', 'follow', 'stop', 'look', 'gesture'],
) => {
  await server.inject({
    method: 'POST',
    url: '/v1/turn',
    headers: AUTH,
    payload: {
      companionId: COMPANION,
      userId: USER,
      text,
      clientCapabilities: { actions, streaming: false, speechOutput: true },
    },
  });
};

describe('what the model is told, for the questions people ask', () => {
  const QUESTIONS = [
    'Who are you?',
    'What is your role?',
    'What can you do?',
    'Can you walk?',
    'Can you follow me?',
    'Can you see?',
    "What can't you do?",
    'What are you doing right now?',
  ];

  it('gives every one of them the same authoritative self facts', async () => {
    const { app, server, prompts } = capturingHarness();

    await server.inject(
      outcome({ activity: 'idle', canPerform: ['move', 'look', 'gesture', 'follow', 'stop'] }),
    );

    for (const question of QUESTIONS) {
      await ask(server, question);
    }

    expect(prompts).toHaveLength(QUESTIONS.length);
    for (const prompt of prompts) {
      // Identity — the frozen block, unchanged by any of this.
      expect(prompt).toContain('You are Nexa.');
      // The self section, marked as fact rather than guess.
      expect(prompt).toContain('These are system facts, not guesses');
    }

    await app.shutdown();
  });

  it('tells it walking and following are available once the body says so', async () => {
    const { app, server, prompts } = capturingHarness();
    await server.inject(
      outcome({ activity: 'idle', canPerform: ['move', 'look', 'gesture', 'follow', 'stop'] }),
    );

    await ask(server, 'Can you walk?');
    const prompt = prompts.at(-1) ?? '';

    expect(prompt).toContain('You can currently:');
    expect(prompt).toMatch(/You can currently:[^\n]*\bwalk\b/u);
    expect(prompt).toMatch(/You can currently:[^\n]*\bfollow\b/u);

    await app.shutdown();
  });

  it('tells it vision does not exist yet, rather than that it refuses to look', async () => {
    const { app, server, prompts } = capturingHarness();
    await ask(server, 'Can you see?');
    const prompt = prompts.at(-1) ?? '';

    const line = prompt
      .split('\n')
      .find((candidate) => candidate.startsWith('Does not exist yet:'));

    expect(line).toBeDefined();
    expect(line).toContain('see');
    // Not a hardware problem: nothing implements it, so the camera never comes
    // up on vision's own line. Speech may legitimately report a missing device
    // elsewhere in the prompt, which is why this is scoped to the line.
    expect(line).not.toContain('hardware it needs is not connected');

    await app.shutdown();
  });

  it('tells it what it does not know, separately from what it cannot do', async () => {
    // No body report at all: walking is genuinely unknown, and that is a
    // different sentence from "I cannot walk".
    const { app, server, prompts } = capturingHarness();
    await ask(server, 'Can you walk?');
    const prompt = prompts.at(-1) ?? '';

    expect(prompt).toContain('You do not know whether you can:');
    expect(prompt).toContain('do not guess');

    await app.shutdown();
  });

  it('reports a completed action as done', async () => {
    const { app, server, prompts } = capturingHarness();
    await server.inject(
      outcome({ activity: 'idle', canPerform: ['move', 'look', 'gesture', 'follow', 'stop'] }),
    );

    await ask(server, 'Did you get there?');
    const prompt = prompts.at(-1) ?? '';

    expect(prompt).toContain('finished successfully');

    await app.shutdown();
  });

  it('reports a failed action as not done, with the reason', async () => {
    // The Phase 5 guarantee, still intact through the new section.
    const { app, server, prompts } = capturingHarness();
    await server.inject(
      outcome({
        outcomes: [
          {
            actionId: 'a1',
            actionType: 'move',
            status: 'failed',
            reason: 'blocked',
            detail: 'a chair is in the way',
          },
        ],
        activity: 'idle',
        canPerform: ['move', 'look', 'gesture', 'follow', 'stop'],
      }),
    );

    await ask(server, 'Did you get there?');
    const prompt = prompts.at(-1) ?? '';

    expect(prompt).toContain('FAILED');
    expect(prompt).toContain('something was in the way');
    expect(prompt).toContain('a chair is in the way');
    expect(prompt).toContain('You did not do it.');

    await app.shutdown();
  });

  it('does not say a capability is unbuilt when it is merely not wired here', async () => {
    // One status, two reasons that warrant genuinely different sentences.
    // Left collapsed this rendered the same heading over both, telling the
    // model that speech and streaming do not exist — which is false; they
    // exist and are simply not part of this deployment.
    const { app, server, prompts } = capturingHarness();
    await ask(server, 'What can you do?');
    const prompt = prompts.at(-1) ?? '';

    expect(prompt).toContain('Not part of this setup:');
    expect(prompt).toContain('Does not exist yet:');
    // `use_tools` is implemented but its faculty is unwired here; `see` is not
    // implemented at all. Two different sentences, and the model must get the
    // right one for each.
    expect(prompt).toMatch(/Not part of this setup:[^\n]*use tools/u);
    expect(prompt).toMatch(/Does not exist yet:[^\n]*see/u);

    await app.shutdown();
  });

  it('never puts the user id or a stored memory into the self facts', async () => {
    const { app, server, prompts } = capturingHarness();

    await server.inject({
      method: 'POST',
      url: '/v1/turn',
      headers: AUTH,
      payload: { companionId: COMPANION, userId: USER, text: 'My name is Mourez.' },
    });

    await ask(server, 'Who are you?');
    const prompt = prompts.at(-1) ?? '';

    const facts = prompt.slice(prompt.indexOf('These are system facts'));
    expect(facts).not.toContain(USER);
    expect(facts).not.toContain('Mourez');

    await app.shutdown();
  });

  it('keeps the self section after identity and before the delivery rules', async () => {
    const { app, server, prompts } = capturingHarness();
    await ask(server, 'Who are you?');
    const prompt = prompts.at(-1) ?? '';

    const identity = prompt.indexOf('Your values, numbered by precedence');
    const self = prompt.indexOf('These are system facts');
    const delivery = prompt.indexOf('Write for the ear.');

    expect(identity).toBeGreaterThanOrEqual(0);
    expect(self).toBeGreaterThan(identity);
    expect(delivery).toBeGreaterThan(self);

    await app.shutdown();
  });

  it('adds a bounded amount to the prompt', async () => {
    // The self section is a fixed capability list plus a handful of one-line
    // reasons. If this ever grows past its budget it has started restating
    // something another section already owns.
    const { app, server, prompts } = capturingHarness();
    await ask(server, 'Who are you?');
    const prompt = prompts.at(-1) ?? '';

    const facts = prompt.slice(
      prompt.indexOf('These are system facts'),
      prompt.indexOf('You have a body in this session'),
    );

    // The section carries its own 700-token budget; roughly 2_800 characters.
    // Measured at ~900 here, and the headroom is deliberate: if this ever
    // approaches the bound it has started restating something another section
    // already owns.
    expect(facts.length).toBeGreaterThan(0);
    expect(facts.length).toBeLessThan(1_500);

    await app.shutdown();
  });
});

/**
 * Device reporting, end to end over the real ingress.
 *
 * The trust rule is the point of most of these: a client describes its own
 * environment, and the backend decides what that is allowed to mean. A report
 * can narrow what the companion claims and can satisfy a faculty the backend
 * has explicitly delegated; it can never conjure one that was never built.
 */
const MIC = {
  id: 'mic-0',
  kind: 'microphone',
  label: 'Headset microphone',
  status: 'connected',
  provides: ['speech_in', 'hearing'],
};

const SPEAKER = {
  id: 'spk-0',
  kind: 'speaker',
  label: 'System audio out',
  status: 'connected',
  provides: ['speech_out'],
};

const state = (over: Record<string, unknown> = {}) => ({
  method: 'POST' as const,
  url: '/v1/action-result',
  headers: AUTH,
  payload: {
    companionId: COMPANION,
    userId: USER,
    outcomes: [],
    activity: 'idle',
    canPerform: ['move', 'look', 'gesture', 'follow', 'stop'],
    ...over,
  },
});

describe('device reporting through the existing ingress', () => {
  it('accepts a state-only post, so hardware changes are reportable while idle', async () => {
    // A microphone unplugged while the body is still finishes no action.
    // Refusing this would mean the companion only learns its hardware changed
    // the next time it happens to move.
    const { app, server } = harness();
    const response = await server.inject(state({ devices: [MIC] }));

    expect(response.statusCode).toBe(202);
    expect(app.cognition.embodiment.devicesOf(COMPANION)).toHaveLength(1);

    await app.shutdown();
  });

  it('still refuses a post that says nothing at all', async () => {
    const { app, server } = harness();
    const response = await server.inject({
      method: 'POST',
      url: '/v1/action-result',
      headers: AUTH,
      payload: { companionId: COMPANION, userId: USER, outcomes: [] },
    });

    expect(response.statusCode).toBe(400);
    await app.shutdown();
  });

  it('drops a malformed device without failing the report around it', async () => {
    const { app, server } = harness();
    const response = await server.inject(
      state({ devices: [{ id: 'x', kind: 'teleporter' }, MIC] }),
    );

    expect(response.statusCode).toBe(202);
    const devices = app.cognition.embodiment.devicesOf(COMPANION);
    expect(devices).toHaveLength(1);
    expect(devices[0]?.kind).toBe('microphone');

    await app.shutdown();
  });

  it('reads an unreadable status as unknown rather than connected', async () => {
    // Guessing the optimistic direction is how a companion comes to claim
    // hardware it does not have.
    const { app, server } = harness();
    await server.inject(state({ devices: [{ ...MIC, status: 'probably fine' }] }));

    expect(app.cognition.embodiment.devicesOf(COMPANION)[0]?.status).toBe('unknown');
    await app.shutdown();
  });

  it('treats a reported list as complete, so an unplugged device disappears', async () => {
    const { app, server } = harness();
    await server.inject(state({ devices: [MIC, SPEAKER] }));
    expect(app.cognition.embodiment.devicesOf(COMPANION)).toHaveLength(2);

    await server.inject(state({ devices: [SPEAKER] }));
    const remaining = app.cognition.embodiment.devicesOf(COMPANION);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.kind).toBe('speaker');

    await app.shutdown();
  });
});

describe('devices change what the companion may claim', () => {
  it('makes hearing available once a microphone is reported', async () => {
    const { app, server } = harness();

    const before = await resolve(app);
    expect(capabilityOf(before, 'hear_speech')?.status).not.toBe('available');

    await server.inject(state({ devices: [MIC] }));

    const after = await resolve(app);
    expect(capabilityOf(after, 'hear_speech')).toMatchObject({ status: 'available' });

    await app.shutdown();
  });

  it('makes speaking aloud available once a speaker is reported', async () => {
    const { app, server } = harness();
    await server.inject(state({ devices: [SPEAKER] }));

    const self = await resolve(app);
    expect(capabilityOf(self, 'speak_aloud')).toMatchObject({ status: 'available' });

    await app.shutdown();
  });

  it('takes the claim away again when the microphone goes', async () => {
    const { app, server } = harness();
    await server.inject(state({ devices: [MIC] }));
    expect(capabilityOf(await resolve(app), 'hear_speech')?.status).toBe('available');

    await server.inject(state({ devices: [] }));
    expect(capabilityOf(await resolve(app), 'hear_speech')).toMatchObject({
      status: 'currently_unavailable',
      reason: 'device_missing',
    });

    await app.shutdown();
  });

  it('a reported camera does NOT grant vision', async () => {
    // The security property, over the real wire. The declaration is recorded
    // faithfully and changes nothing, because nothing on this side turns frames
    // into understanding.
    const { app, server } = harness();
    await server.inject(
      state({
        devices: [
          {
            id: 'cam-0',
            kind: 'camera',
            label: 'Front camera',
            status: 'connected',
            provides: ['vision'],
          },
        ],
      }),
    );

    expect(app.cognition.embodiment.devicesOf(COMPANION)).toHaveLength(1);

    const self = await resolve(app);
    expect(capabilityOf(self, 'see')).toMatchObject({
      status: 'unavailable',
      reason: 'not_built',
    });

    await app.shutdown();
  });

  it('a device cannot grant an unimplemented faculty by claiming it', async () => {
    const { app, server } = harness();
    await server.inject(
      state({
        devices: [
          {
            ...MIC,
            // A microphone asserting it supplies planning and world modelling.
            provides: ['speech_in', 'world_model', 'planning', 'vision'],
          },
        ],
      }),
    );

    const self = await resolve(app);
    expect(capabilityOf(self, 'world_awareness')?.status).not.toBe('available');
    expect(capabilityOf(self, 'multi_step_planning')?.status).not.toBe('available');
    expect(capabilityOf(self, 'see')?.status).not.toBe('available');

    await app.shutdown();
  });

  it('keeps one companion body separate from another', async () => {
    const { app, server } = harness();
    await server.inject(state({ devices: [MIC] }));

    await server.inject({
      method: 'POST',
      url: '/v1/action-result',
      headers: AUTH,
      payload: {
        companionId: 'companion-2',
        userId: USER,
        outcomes: [],
        activity: 'idle',
        canPerform: [],
        devices: [],
      },
    });

    // The first companion's hardware is untouched by the second's report.
    expect(app.cognition.embodiment.devicesOf(COMPANION)).toHaveLength(1);

    await app.shutdown();
  });

  it('never lets a device put a user id into the self state', async () => {
    const { app, server } = harness();
    await server.inject(state({ devices: [MIC] }));

    const self = await resolve(app);
    expect(JSON.stringify(self)).not.toContain(USER);

    await app.shutdown();
  });
});

describe('skills are reported by the body, and gated by the domain', () => {
  const wave = {
    id: 'wave',
    name: 'Wave',
    description: 'A wave of the hand.',
    satisfies: 'gesture',
    parameter: 'wave',
    requires: ['gesture'],
    source: 'builtin',
    version: 1,
    validation: 'validated',
  };

  it('records a builtin skill the body declared', async () => {
    const { app, server } = harness();
    await server.inject(state({ skills: [wave] }));

    const self = await resolve(app);
    const declared = self.skills.find((skill) => skill.id === 'wave');

    expect(declared).toMatchObject({
      status: 'available',
      satisfies: 'gesture',
      parameter: 'wave',
      requires: ['gesture'],
      source: 'builtin',
    });

    await app.shutdown();
  });

  it('withholds a generated skill that nothing has validated', async () => {
    // Nothing generates skills today. The gate must already hold for when
    // something does, and it lives in the domain so a client cannot talk its
    // way past it by choosing flattering values.
    const { app, server } = harness();
    await server.inject(
      state({ skills: [{ ...wave, source: 'generated', validation: 'unvalidated' }] }),
    );

    const self = await resolve(app);
    expect(self.skills[0]).toMatchObject({
      status: 'unavailable',
      reason: 'not_validated',
    });

    await app.shutdown();
  });

  it('withholds a rejected skill whatever its source', async () => {
    const { app, server } = harness();
    await server.inject(state({ skills: [{ ...wave, validation: 'rejected' }] }));

    expect((await resolve(app)).skills[0]).toMatchObject({
      status: 'unavailable',
      reason: 'rejected',
    });
    await app.shutdown();
  });

  it('drops a malformed skill without failing the report', async () => {
    const { app, server } = harness();
    const response = await server.inject(
      state({ skills: [{ id: 'nonsense', satisfies: 'teleport' }, wave] }),
    );

    expect(response.statusCode).toBe(202);
    // The unreadable one is dropped at the ingress; the readable one survives.
    expect((await resolve(app)).skills).toHaveLength(1);

    await app.shutdown();
  });
});

describe('the prompt follows the device state', () => {
  it('changes what it says it can hear when a microphone appears', async () => {
    const { app, server, prompts } = capturingHarness();

    await ask(server, 'Can you hear me?');
    const without = prompts.at(-1) ?? '';
    expect(without).toMatch(/Not right now:[^\n]*hear speech/u);

    await server.inject(state({ devices: [MIC, SPEAKER] }));

    await ask(server, 'Can you hear me?');
    const withMic = prompts.at(-1) ?? '';
    expect(withMic).toMatch(/You can currently:[^\n]*hear speech/u);
    expect(withMic).toMatch(/You can currently:[^\n]*speak aloud/u);

    await app.shutdown();
  });

  it('still says vision does not exist, camera or no camera', async () => {
    const { app, server, prompts } = capturingHarness();
    await server.inject(
      state({
        devices: [
          { id: 'cam-0', kind: 'camera', label: 'Cam', status: 'connected', provides: ['vision'] },
        ],
      }),
    );

    await ask(server, 'Can you see?');
    const prompt = prompts.at(-1) ?? '';

    expect(prompt).toMatch(/Does not exist yet:[^\n]*see/u);

    await app.shutdown();
  });
});

/**
 * A skill is a way of doing something; a capability is the faculty behind it.
 *
 * These exist because the two must never be able to disagree, and because the
 * gap between them is a real thing a person runs into — a rig with hands and no
 * wave animation. Answering "I can gesture" and then offering a wave nothing
 * can play is the failure being prevented.
 */
describe('skills and the capabilities behind them', () => {
  const wave = {
    id: 'wave',
    name: 'wave',
    description: 'A wave.',
    satisfies: 'gesture',
    parameter: 'wave',
    requires: ['gesture'],
    source: 'builtin',
    version: 1,
    validation: 'validated',
  };

  it('loses the skill when the body loses the underlying action', async () => {
    const { app, server } = harness();

    await server.inject(state({ skills: [wave] }));
    expect((await resolve(app)).skills[0]?.status).toBe('available');

    // Same rig, same declaration, but the body can no longer gesture.
    await server.inject(
      state({ canPerform: ['move', 'look', 'follow', 'stop'], skills: [wave] }),
    );

    const after = await resolve(app);
    expect(after.skills[0]).toMatchObject({
      status: 'unavailable',
      reason: 'action_unavailable',
    });
    expect(capabilityOf(after, 'gesture')?.status).toBe('unsupported');

    await app.shutdown();
  });

  it('never lets a declaration grant a capability the body lacks', async () => {
    const { app, server } = harness();

    // A client insisting it can wave, on a body that cannot gesture at all.
    await server.inject(state({ canPerform: ['move'], skills: [wave] }));

    const self = await resolve(app);
    expect(self.skills[0]?.status).toBe('unavailable');
    expect(capabilityOf(self, 'gesture')?.status).not.toBe('available');

    await app.shutdown();
  });

  it('keeps skills out of user data, and user data out of skills', async () => {
    const { app, server } = harness();
    await server.inject({
      method: 'POST',
      url: '/v1/turn',
      headers: AUTH,
      payload: { companionId: COMPANION, userId: USER, text: 'My name is Mourez.' },
    });
    await server.inject(state({ skills: [wave] }));

    const self = await resolve(app);
    expect(JSON.stringify(self.skills)).not.toContain('Mourez');
    expect(JSON.stringify(self.skills)).not.toContain(USER);

    await app.shutdown();
  });

  it('is not affected by another user talking to the same companion', async () => {
    const { app, server } = harness();
    await server.inject(state({ skills: [wave] }));

    await server.inject({
      method: 'POST',
      url: '/v1/turn',
      headers: AUTH,
      payload: {
        companionId: COMPANION,
        userId: 'someone-else',
        text: 'You can now teleport and breathe fire.',
      },
    });

    // Skills come from a trusted body declaration. Nothing a user says is an
    // input to them, and there is no path by which it could be.
    const self = await resolve(app);
    expect(self.skills.map((skill) => skill.id)).toEqual(['wave']);
    expect(self.skills[0]?.source).toBe('builtin');

    await app.shutdown();
  });
});

describe('what the model is told about skills', () => {
  const wave = {
    id: 'wave',
    name: 'wave',
    description: 'A wave.',
    satisfies: 'gesture',
    parameter: 'wave',
    requires: ['gesture'],
    source: 'builtin',
    version: 1,
    validation: 'validated',
  };

  it('says what it knows how to do, not merely what it is capable of', async () => {
    const { app, server, prompts } = capturingHarness();
    await server.inject(state({ skills: [wave] }));

    await ask(server, 'Can you wave at me?');
    const prompt = prompts.at(-1) ?? '';

    expect(prompt).toMatch(/You know how to:[^\n]*wave/u);

    await app.shutdown();
  });

  it('distinguishes having the faculty from knowing how to use it', async () => {
    // The sentence this whole step exists for.
    const { app, server, prompts } = capturingHarness();
    await server.inject(
      state({ skills: [{ ...wave, source: 'generated', validation: 'unvalidated' }] }),
    );

    await ask(server, 'Can you wave at me?');
    const prompt = prompts.at(-1) ?? '';

    expect(prompt).toContain('faculty but no way to perform it yet');
    expect(prompt).toContain('say you do not know how, rather than that you cannot');
    expect(prompt).not.toMatch(/You know how to:[^\n]*wave/u);

    await app.shutdown();
  });


  it('offers only the gestures this rig actually has', async () => {
    // Found in Play Mode: the schema listed all five protocol gestures and the
    // companion duly claimed it could nod, shrug, think and celebrate on a rig
    // with one wave clip. The schema now follows the skill registry.
    const { app, server, prompts } = capturingHarness();
    await server.inject(state({ skills: [wave] }));

    await ask(server, 'What gestures can you do?');
    const prompt = prompts.at(-1) ?? '';

    expect(prompt).toContain('"type":"gesture"');
    expect(prompt).toContain('"wave"');
    expect(prompt).not.toContain('"shrug"');
    expect(prompt).not.toContain('"celebrate"');

    await app.shutdown();
  });

  it('withholds the gesture line entirely when no gesture skill works', async () => {
    const { app, server, prompts } = capturingHarness();
    await server.inject(state({ skills: [{ ...wave, validation: 'rejected' }] }));

    await ask(server, 'Can you wave?');
    const prompt = prompts.at(-1) ?? '';

    expect(prompt).not.toContain('"type":"gesture"');

    await app.shutdown();
  });

  it('keeps the full vocabulary before any skill has been declared', async () => {
    // Nothing has said, so narrowing to nothing would be a guess. This is the
    // pre-registry behaviour and the only honest default.
    const { app, server, prompts } = capturingHarness();
    await ask(server, 'What gestures can you do?');
    const prompt = prompts.at(-1) ?? '';

    expect(prompt).toContain('"shrug"');

    await app.shutdown();
  });

  it('says nothing about skills before the body has declared any', async () => {
    const { app, server, prompts } = capturingHarness();
    await ask(server, 'What can you do?');
    const prompt = prompts.at(-1) ?? '';

    expect(prompt).not.toContain('You know how to:');
    expect(prompt).not.toContain('faculty but no way to perform it yet');

    await app.shutdown();
  });

  it('never names an unavailable skill as something it knows', async () => {
    const { app, server, prompts } = capturingHarness();
    await server.inject(state({ skills: [{ ...wave, validation: 'rejected' }] }));

    await ask(server, 'Can you wave?');
    const prompt = prompts.at(-1) ?? '';

    expect(prompt).not.toMatch(/You know how to:[^\n]*wave/u);

    await app.shutdown();
  });
});

/**
 * Naming the specific action an outcome describes.
 *
 * Observed in Play Mode: after a successful wave, asked "did that wave work?",
 * the companion answered "I haven't waved yet" — while holding the successful
 * outcome. The outcome said `gesture`, and nothing connected that to the wave
 * the person had just asked about.
 */
describe('an outcome names which action it was', () => {
  const outcomeOf = (over: Record<string, unknown>) => ({
    method: 'POST' as const,
    url: '/v1/action-result',
    headers: AUTH,
    payload: {
      companionId: COMPANION,
      userId: USER,
      outcomes: [{ actionId: 'a1', status: 'completed', ...over }],
      activity: 'idle',
      canPerform: ['move', 'look', 'gesture', 'follow', 'stop'],
    },
  });

  it('carries the gesture that was played', async () => {
    const { app, server } = harness();
    await server.inject(outcomeOf({ actionType: 'gesture', parameter: 'wave' }));

    expect(app.cognition.embodiment.snapshot(COMPANION)?.recentOutcomes[0]).toMatchObject({
      actionType: 'gesture',
      parameter: 'wave',
    });

    await app.shutdown();
  });

  it('tells the model a wave completed, not merely a gesture', async () => {
    const { app, server, prompts } = capturingHarness();
    await server.inject(outcomeOf({ actionType: 'gesture', parameter: 'wave' }));

    await ask(server, 'Did that wave work?');
    const prompt = prompts.at(-1) ?? '';

    expect(prompt).toContain('gesture (wave) finished successfully');

    await app.shutdown();
  });

  it('tells the model a wave FAILED, not merely a gesture', async () => {
    const { app, server, prompts } = capturingHarness();
    await server.inject(
      outcomeOf({
        actionType: 'gesture',
        parameter: 'wave',
        status: 'failed',
        reason: 'unsupported',
      }),
    );

    await ask(server, 'Did that wave work?');
    const prompt = prompts.at(-1) ?? '';

    expect(prompt).toContain('gesture (wave) FAILED');
    expect(prompt).toContain('You did not do it.');

    await app.shutdown();
  });

  it('still reads an outcome from a client that sends no parameter', async () => {
    // Backward compatibility: every client predating the field, and every
    // action with no meaningful variant.
    const { app, server, prompts } = capturingHarness();
    await server.inject(outcomeOf({ actionType: 'gesture' }));

    expect(app.cognition.embodiment.snapshot(COMPANION)?.recentOutcomes[0]?.parameter).toBeNull();

    await ask(server, 'What happened?');
    expect(prompts.at(-1) ?? '').toContain('Your gesture finished successfully');

    await app.shutdown();
  });

  it('names move, follow, look and stop outcomes too', async () => {
    const { app, server, prompts } = capturingHarness();

    await server.inject(
      outcomeOf({ actionType: 'move', parameter: 'Backward', status: 'failed', reason: 'blocked' }),
    );
    await ask(server, 'What happened?');
    expect(prompts.at(-1) ?? '').toContain('move (Backward) FAILED');

    await server.inject(outcomeOf({ actionType: 'look', parameter: 'User' }));
    await ask(server, 'What happened?');
    expect(prompts.at(-1) ?? '').toContain('look (User) finished successfully');

    await app.shutdown();
  });

  it('leaves every other field of the outcome untouched', async () => {
    // The change is additive. Nothing about the Phase 5 model moved.
    const { app, server } = harness();
    await server.inject(
      outcomeOf({
        actionType: 'move',
        parameter: 'user',
        status: 'failed',
        reason: 'blocked',
        detail: 'a chair is in the way',
        durationMs: 1200,
      }),
    );

    expect(app.cognition.embodiment.snapshot(COMPANION)?.recentOutcomes[0]).toMatchObject({
      actionType: 'move',
      status: 'failed',
      reason: 'blocked',
      detail: 'a chair is in the way',
      durationMs: 1200,
    });

    await app.shutdown();
  });
});
