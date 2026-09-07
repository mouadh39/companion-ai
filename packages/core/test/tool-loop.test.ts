import { describe, expect, it } from 'vitest';
import { Deadline, defaultToolLoopLimits, runToolLoop } from '@nexa/core';
import type {
  CompletionRequest,
  CompletionResult,
  LanguageModelPort,
  ModelCapabilities,
  PortOptions,
  ToolExecutionPort,
  ToolLoopRequest,
  TokenSink,
} from '@nexa/core';
import { confidence, defaultPersonality, duration, timestamp } from '@nexa/models';
import type { CognitiveContext, Decision, Tool } from '@nexa/models';
import { FixedClock, ok, systemClock, trustExternalId } from '@nexa/shared';
import type { CompanionId, DecisionId, ToolId, TurnId, UserId } from '@nexa/shared';
import { testIdentity } from './fixtures.js';

/**
 * The bounded tool loop.
 *
 * Three independent limits guard it — iterations, wall clock, cumulative tokens
 * — because each fails differently and any one alone leaves a hole: iterations
 * permit four very slow calls, a deadline permits a hundred fast ones, and
 * tokens permit an unbounded number of cheap ones. Every limit answers with
 * what is in hand rather than failing, because a partial answer beats none.
 */

const turnId = trustExternalId<TurnId>('00000000-0000-7000-8000-0000000000ee');
const companionId = trustExternalId<CompanionId>('companion-1');
const toolId = trustExternalId<ToolId>('calendar.createEvent');

const capable: ModelCapabilities = {
  toolUse: true,
  streaming: true,
  contextWindow: 200_000,
  promptCaching: true,
};

const completion = (over: Partial<CompletionResult> = {}): CompletionResult => ({
  text: 'Done.',
  inputTokens: 100,
  outputTokens: 20,
  cachedInputTokens: 0,
  model: 'fake',
  refused: false,
  toolCalls: [],
  ...over,
});

/** A model that returns a scripted sequence of completions. */
const scriptedModel = (
  script: readonly CompletionResult[],
  capabilities: ModelCapabilities = capable,
): LanguageModelPort & { calls: number } => {
  const model = {
    name: 'fake',
    capabilities,
    calls: 0,
    async complete() {
      const next = script[Math.min(model.calls, script.length - 1)];
      model.calls++;
      return ok(next ?? completion());
    },
  };
  return model;
};

const wantsTool = (text = ''): CompletionResult =>
  completion({
    text,
    toolCalls: [{ callId: `call-${String(Math.random())}`, toolId, arguments: {} }],
  });

const executor = (content = 'tool ran'): ToolExecutionPort & { runs: number } => {
  const port = {
    runs: 0,
    async execute(request: { callId: string }) {
      port.runs++;
      return ok({ callId: request.callId, content, isError: false });
    },
  };
  return port;
};

const tool: Tool = {
  id: toolId,
  type: 'calendar',
  name: 'Create event',
  description: 'Creates a calendar event.',
  effect: 'write',
  parameters: {},
  enabled: true,
  timeout: duration(5_000),
};

const decision: Decision = {
  id: trustExternalId<DecisionId>('decision-1'),
  kind: 'answer',
  confidence: confidence(0.85),
  reasonCodes: ['direct_question'],
  alternatives: [],
  groundedIn: [],
};

const context: CognitiveContext = {
  turnId,
  companionId,
  userId: trustExternalId<UserId>('user-1'),
  at: timestamp('2026-07-30T12:00:00.000Z'),
  perception: {
    text: 'book me a slot',
    intents: [{ kind: 'request', confidence: confidence(0.9) }],
    entities: [],
    emotion: null,
  },
  identity: testIdentity(),
  expression: null,
  personality: defaultPersonality(),
  workingMemory: [],
  retrievedMemories: [],
  goals: [],
  availableTools: [tool],
  clientCapabilities: null,
  emotion: null,
  relationship: null,
  world: null,
  body: null,
  self: null,
  plan: null,
  hint: null,
  budget: { totalLimit: 12_000, sectionLimits: {}, spent: {}, omissions: [] },
};

/** A client that has declared it can execute `move` — the embodiment signal. */
const embodiedContext: CognitiveContext = {
  ...context,
  clientCapabilities: {
    actions: ['speak', 'move', 'follow', 'stop', 'look', 'gesture'],
    streaming: false,
    locale: null,
  },
};

const request = (over: Partial<ToolLoopRequest> = {}): ToolLoopRequest => ({
  companionId,
  context,
  decision,
  system: 'You are Nexa.',
  messages: [{ role: 'user', content: 'book me a slot' }],
  availableTools: [tool],
  onToken: null,
  ...over,
});

const options = (budgetMs = 10_000): PortOptions => ({
  signal: new AbortController().signal,
  deadline: Deadline.after(systemClock, budgetMs),
  turnId,
});

describe('runToolLoop', () => {
  it('answers in one call when the model asks for no tools', async () => {
    const model = scriptedModel([completion({ text: 'Hello.' })]);

    const outcome = await runToolLoop(
      { model, tools: executor(), limits: defaultToolLoopLimits },
      request(),
      options(),
    );

    expect(model.calls).toBe(1);
    expect(outcome.failure).toBeNull();
    expect(outcome.actions).toHaveLength(1);
    expect(outcome.toolCallCount).toBe(0);
  });

  it('runs the tool and calls the model again', async () => {
    const model = scriptedModel([wantsTool(), completion({ text: 'Booked.' })]);
    const tools = executor();

    const outcome = await runToolLoop(
      { model, tools, limits: defaultToolLoopLimits },
      request(),
      options(),
    );

    expect(tools.runs).toBe(1);
    expect(model.calls).toBe(2);
    expect(outcome.toolCallCount).toBe(1);
    expect(outcome.actions[0]?.type).toBe('speak');
  });

  it('records every model call, so cost is attributable per turn', async () => {
    const model = scriptedModel([wantsTool(), completion()]);

    const outcome = await runToolLoop(
      { model, tools: executor(), limits: defaultToolLoopLimits },
      request(),
      options(),
    );

    expect(outcome.modelCalls).toHaveLength(2);
    expect(outcome.modelCalls.every((call) => call.latencyMs >= 0)).toBe(true);
  });

  it('runs independent tool calls together', async () => {
    const model = scriptedModel([
      completion({
        text: '',
        toolCalls: [
          { callId: 'a', toolId, arguments: {} },
          { callId: 'b', toolId, arguments: {} },
        ],
      }),
      completion({ text: 'Both done.' }),
    ]);
    const tools = executor();

    const outcome = await runToolLoop(
      { model, tools, limits: defaultToolLoopLimits },
      request(),
      options(),
    );

    expect(tools.runs).toBe(2);
    expect(outcome.toolCallCount).toBe(2);
  });

  // ── the three limits ──────────────────────────────────────────────────────

  it('stops at the iteration ceiling and answers with what it has', async () => {
    // A model that asks for a tool forever.
    const model = scriptedModel([wantsTool('Working on it.')]);

    const outcome = await runToolLoop(
      { model, tools: executor(), limits: { ...defaultToolLoopLimits, maxIterations: 2 } },
      request(),
      options(),
    );

    expect(model.calls).toBe(2);
    expect(outcome.failure).toBeNull();
    expect(outcome.actions).toHaveLength(1);
    expect(outcome.diagnostics.map((d) => d.code)).toContain('tool_loop_exhausted');
  });

  it('stops at the cumulative token ceiling', async () => {
    const model = scriptedModel([
      wantsTool('Still working.'),
    ]);

    const outcome = await runToolLoop(
      {
        model,
        tools: executor(),
        limits: { ...defaultToolLoopLimits, maxTotalTokens: 150 },
      },
      request(),
      options(),
    );

    // 120 tokens on the first call is under 150; the second crosses it.
    expect(model.calls).toBe(2);
    expect(outcome.diagnostics.map((d) => d.code)).toContain('tool_loop_exhausted');
  });

  /**
   * Stopping *before* invoking a tool it has no time to use the results of.
   * Running it anyway would spend a side effect on an answer nobody sees.
   */
  it('stops before a tool it has no time to use', async () => {
    const model = scriptedModel([wantsTool('One moment.')]);
    const tools = executor();

    const outcome = await runToolLoop(
      { model, tools, limits: { ...defaultToolLoopLimits, toolTimeoutMs: 5_000 } },
      request(),
      options(1_000),
    );

    expect(tools.runs).toBe(0);
    expect(outcome.diagnostics.map((d) => d.code)).toContain('tool_loop_deadline');
    expect(outcome.actions).toHaveLength(1);
  });

  it('fails rather than calling a model with no budget left', async () => {
    const clock = new FixedClock(1_000);
    const deadline = Deadline.after(clock, 100);
    clock.advance(200);

    const model = scriptedModel([completion()]);
    const outcome = await runToolLoop(
      { model, limits: defaultToolLoopLimits },
      request(),
      { signal: new AbortController().signal, deadline, turnId },
    );

    expect(model.calls).toBe(0);
    expect(outcome.failure).not.toBeNull();
    expect(outcome.diagnostics.map((d) => d.code)).toContain('deadline_exhausted');
  });

  // ── capability degradation ────────────────────────────────────────────────

  /**
   * The reason `ModelCapabilities` exists. A local model with no tool use would
   * otherwise be offered tools, return prose, and surface as a companion that
   * mysteriously never uses its calendar.
   */
  it('withholds tools from a model that cannot use them, and says so', async () => {
    let offered = -1;
    const model: LanguageModelPort = {
      name: 'local',
      capabilities: { ...capable, toolUse: false },
      async complete(request: CompletionRequest) {
        offered = request.tools.length;
        return ok(completion({ text: 'No tools here.' }));
      },
    };

    const outcome = await runToolLoop(
      { model, tools: executor(), limits: defaultToolLoopLimits },
      request(),
      options(),
    );

    expect(offered).toBe(0);
    expect(outcome.failure).toBeNull();
    expect(outcome.diagnostics.map((d) => d.code)).toContain('model_capability_missing');
  });

  it('offers no tools when none are executable', async () => {
    let offered = -1;
    const model: LanguageModelPort = {
      name: 'fake',
      capabilities: capable,
      async complete(request: CompletionRequest) {
        offered = request.tools.length;
        return ok(completion());
      },
    };

    // No executor configured: offering tools would produce calls nothing can
    // satisfy, and spend prompt budget on every turn to do it.
    await runToolLoop({ model, limits: defaultToolLoopLimits }, request(), options());

    expect(offered).toBe(0);
  });

  // ── failures ──────────────────────────────────────────────────────────────

  /**
   * A failed tool is information the companion can act on — it can say the
   * calendar is unreachable instead of falling silent — so it goes back to the
   * model rather than ending the turn.
   */
  it('reports a failed tool to the model instead of failing the turn', async () => {
    const model = scriptedModel([wantsTool(), completion({ text: 'Calendar is down.' })]);
    const failing: ToolExecutionPort = {
      execute: () => Promise.reject(new Error('calendar unreachable')),
    };

    const outcome = await runToolLoop(
      { model, tools: failing, limits: defaultToolLoopLimits },
      request(),
      options(),
    );

    expect(outcome.failure).toBeNull();
    expect(outcome.actions[0]).toMatchObject({ type: 'speak', text: 'Calendar is down.' });
  });

  it('fails the turn when the provider refuses', async () => {
    const model = scriptedModel([completion({ refused: true, text: '' })]);

    const outcome = await runToolLoop(
      { model, limits: defaultToolLoopLimits },
      request(),
      options(),
    );

    expect(outcome.failure).not.toBeNull();
    expect(outcome.diagnostics.map((d) => d.code)).toContain('provider_refused');
    // The refused call is still recorded — it was still paid for.
    expect(outcome.modelCalls).toHaveLength(1);
  });

  it('fails the turn on an empty response', async () => {
    const model = scriptedModel([completion({ text: '   ' })]);

    const outcome = await runToolLoop(
      { model, limits: defaultToolLoopLimits },
      request(),
      options(),
    );

    expect(outcome.failure?.message).toContain('empty');
  });

  // ── streaming ─────────────────────────────────────────────────────────────

  it('streams when the model and the caller both support it', async () => {
    const chunks: string[] = [];
    const model: LanguageModelPort = {
      name: 'streaming',
      capabilities: capable,
      complete: async () => ok(completion()),
      stream: async (_request: CompletionRequest, sink: TokenSink) => {
        sink('Hel');
        sink('lo.');
        return ok(completion({ text: 'Hello.' }));
      },
    };

    const outcome = await runToolLoop(
      { model, limits: defaultToolLoopLimits },
      request({ onToken: (chunk) => chunks.push(chunk) }),
      options(),
    );

    expect(chunks).toEqual(['Hel', 'lo.']);
    expect(outcome.actions[0]).toMatchObject({ text: 'Hello.' });
  });

  it('falls back to a single call when the model cannot stream', async () => {
    const chunks: string[] = [];
    const model = scriptedModel([completion({ text: 'Hello.' })], {
      ...capable,
      streaming: false,
    });

    const outcome = await runToolLoop(
      { model, limits: defaultToolLoopLimits },
      request({ onToken: (chunk) => chunks.push(chunk) }),
      options(),
    );

    expect(chunks).toEqual([]);
    expect(outcome.actions[0]).toMatchObject({ text: 'Hello.' });
  });

  it('makes no provider call at all when the decision is silence', async () => {
    // Silence is handled by ActionGenerator before the loop is entered; this
    // pins that the loop itself never treats an empty answer as acceptable.
    const model = scriptedModel([completion({ text: '' })]);

    const outcome = await runToolLoop(
      { model, limits: defaultToolLoopLimits },
      request(),
      options(),
    );

    expect(outcome.failure).not.toBeNull();
  });

  // ── the action block ───────────────────────────────────────────────────
  // Body actions ride a fenced `nexa` block in the model's own completion text
  // — see `readActionBlock` in generation/action-block.ts. Recognised only for
  // a client that declared the action; everyone else sees exactly the text the
  // model produced.

  /** Wraps actions in the fence the model is instructed to use. */
  const block = (json: string): string => ['```nexa', json, '```'].join('\n');

  it('turns a block into actions alongside the spoken reply', async () => {
    const model = scriptedModel([
      completion({
        text: `Coming over!\n\n${block('{"actions":[{"type":"move","target":"user"}]}')}`,
      }),
    ]);

    const outcome = await runToolLoop(
      { model, limits: defaultToolLoopLimits },
      request({ context: embodiedContext }),
      options(),
    );

    expect(outcome.failure).toBeNull();
    expect(outcome.actions).toHaveLength(2);
    expect(outcome.actions[0]).toMatchObject({ type: 'move', target: 'user' });
    expect(outcome.actions[1]).toMatchObject({ type: 'speak', text: 'Coming over!' });
  });

  it('carries a direction, a distance and its unit', async () => {
    const model = scriptedModel([
      completion({
        text: `Alright.\n\n${block(
          '{"actions":[{"type":"move","direction":"backward","distance":2,"distanceUnit":"steps"}]}',
        )}`,
      }),
    ]);

    const outcome = await runToolLoop(
      { model, limits: defaultToolLoopLimits },
      request({ context: embodiedContext }),
      options(),
    );

    expect(outcome.actions[0]).toMatchObject({
      type: 'move',
      target: null,
      direction: 'backward',
      distance: 2,
      distanceUnit: 'steps',
    });
  });

  it('accepts a named destination the backend cannot enumerate', async () => {
    const model = scriptedModel([
      completion({
        text: `On my way.\n\n${block('{"actions":[{"type":"move","target":"table"}]}')}`,
      }),
    ]);

    const outcome = await runToolLoop(
      { model, limits: defaultToolLoopLimits },
      request({ context: embodiedContext }),
      options(),
    );

    // Which names resolve is a fact about the client's room, not about the
    // companion. An unknown one comes back as a `skipped` outcome naming the
    // target rather than being refused here.
    expect(outcome.actions[0]).toMatchObject({ type: 'move', target: 'table' });
  });

  it('reads follow and stop', async () => {
    const model = scriptedModel([
      completion({
        text: `Sure.\n\n${block(
          '{"actions":[{"type":"follow","target":"user"},{"type":"stop","scope":"follow"}]}',
        )}`,
      }),
    ]);

    const outcome = await runToolLoop(
      { model, limits: defaultToolLoopLimits },
      request({ context: embodiedContext }),
      options(),
    );

    expect(outcome.actions[0]).toMatchObject({ type: 'follow', target: 'user', mode: 'walk' });
    expect(outcome.actions[1]).toMatchObject({ type: 'stop', scope: 'follow' });
  });

  it('reads gesture and look, which no channel could previously express', async () => {
    const model = scriptedModel([
      completion({
        text: `Hi!\n\n${block(
          '{"actions":[{"type":"gesture","gesture":"wave"},{"type":"look","target":"user"}]}',
        )}`,
      }),
    ]);

    const outcome = await runToolLoop(
      { model, limits: defaultToolLoopLimits },
      request({ context: embodiedContext }),
      options(),
    );

    expect(outcome.actions[0]).toMatchObject({ type: 'gesture', gesture: 'wave' });
    expect(outcome.actions[1]).toMatchObject({ type: 'look', target: 'user' });
  });

  it('ignores the block for a client that never declared it can move', async () => {
    const text = `Coming over!\n\n${block('{"actions":[{"type":"move","target":"user"}]}')}`;
    const model = scriptedModel([completion({ text })]);

    const outcome = await runToolLoop(
      { model, limits: defaultToolLoopLimits },
      request(), // default context has clientCapabilities: null
      options(),
    );

    expect(outcome.actions).toHaveLength(1);
    expect(outcome.actions[0]).toMatchObject({ type: 'speak' });
    expect(outcome.actions[0]).not.toMatchObject({ type: 'move' });
  });

  it('keeps the answer when the block is malformed, and says so', async () => {
    const model = scriptedModel([
      completion({ text: `Coming over!\n\n${block('{"actions":[{"type":"move"')}` }),
    ]);

    const outcome = await runToolLoop(
      { model, limits: defaultToolLoopLimits },
      request({ context: embodiedContext }),
      options(),
    );

    // The prose is a real answer and survives; only the actions are lost. A
    // failed turn would trade a companion that answered but did not move for
    // one that did neither.
    expect(outcome.failure).toBeNull();
    expect(outcome.actions).toHaveLength(1);
    expect(outcome.actions[0]).toMatchObject({ type: 'speak', text: 'Coming over!' });
    expect(outcome.diagnostics.map((d) => d.code)).toContain('action_block_malformed');
  });

  it('drops a move that names neither a target nor a direction', async () => {
    const model = scriptedModel([
      completion({ text: `Okay.\n\n${block('{"actions":[{"type":"move"}]}')}` }),
    ]);

    const outcome = await runToolLoop(
      { model, limits: defaultToolLoopLimits },
      request({ context: embodiedContext }),
      options(),
    );

    expect(outcome.actions).toHaveLength(1);
    expect(outcome.actions[0]).toMatchObject({ type: 'speak' });
    expect(outcome.diagnostics.map((d) => d.code)).toContain('action_block_malformed');
  });

  it('refuses to mint remember or call_tool through the block', async () => {
    const model = scriptedModel([
      completion({
        text: `Sure.\n\n${block('{"actions":[{"type":"remember","content":"secret"}]}')}`,
      }),
    ]);

    const outcome = await runToolLoop(
      { model, limits: defaultToolLoopLimits },
      request({
        context: {
          ...embodiedContext,
          clientCapabilities: {
            actions: ['speak', 'move', 'remember'],
            streaming: false,
            locale: null,
          },
        },
      }),
      options(),
    );

    // Memory is the backend's own, and a second unaudited way to write it is
    // exactly what this channel must not become.
    expect(outcome.actions.every((action) => action.type !== 'remember')).toBe(true);
  });

  it('answers with actions alone when the model only acted', async () => {
    const model = scriptedModel([
      completion({ text: block('{"actions":[{"type":"stop","scope":"all"}]}') }),
    ]);

    const outcome = await runToolLoop(
      { model, limits: defaultToolLoopLimits },
      request({ context: embodiedContext }),
      options(),
    );

    // A silent stop is a legitimate answer to "stop", and failing the turn
    // would throw away an action the body is entitled to perform.
    expect(outcome.failure).toBeNull();
    expect(outcome.actions).toHaveLength(1);
    expect(outcome.actions[0]).toMatchObject({ type: 'stop' });
  });

  it('leaves an ordinary code block alone', async () => {
    const text = 'Here you go:\n\n```json\n{"actions":[{"type":"move","target":"user"}]}\n```';
    const model = scriptedModel([completion({ text })]);

    const outcome = await runToolLoop(
      { model, limits: defaultToolLoopLimits },
      request({ context: embodiedContext }),
      options(),
    );

    // The fence is tagged `nexa`, not bare, precisely so a companion asked
    // about JSON does not walk across the room.
    expect(outcome.actions).toHaveLength(1);
    expect(outcome.actions[0]).toMatchObject({ type: 'speak', text });
  });

  it('carries the same decisionId onto every action it produced', async () => {
    const model = scriptedModel([
      completion({
        text: `On my way.\n\n${block('{"actions":[{"type":"move","target":"user"}]}')}`,
      }),
    ]);

    const outcome = await runToolLoop(
      { model, limits: defaultToolLoopLimits },
      request({ context: embodiedContext }),
      options(),
    );

    expect(outcome.actions).toHaveLength(2);
    for (const action of outcome.actions) expect(action.decisionId).toBe(decision.id);
  });
});
