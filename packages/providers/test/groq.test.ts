import { describe, expect, it } from 'vitest';
import type { CompletionRequest, PortOptions } from '@nexa/core';
import type { Tool } from '@nexa/models';
import type { FetchLike } from '@nexa/providers';
import { GroqLanguageModel } from '@nexa/providers';

/**
 * Tests for the Groq adapter.
 *
 * `fetch` is injected rather than the global being patched, so these run with
 * no key, no network and no spend — and so a failure here is unambiguously a
 * defect in the mapping rather than a flaky endpoint.
 *
 * They assert on two things and nothing else: the request Groq receives, and
 * how a response becomes a `CompletionResult` or a `ProviderError`. Everything
 * else about a turn is Core's, and this adapter is not the place to re-test it.
 */

const request = (overrides: Partial<CompletionRequest> = {}): CompletionRequest => ({
  system: 'You are Nexa.',
  messages: [{ role: 'user', content: 'Hello Nexa' }],
  maxTokens: 512,
  tools: [],
  ...overrides,
});

const completion = (
  message: Record<string, unknown> = { role: 'assistant', content: 'Hello. Good to hear from you.' },
  finishReason = 'stop',
): unknown => ({
  model: 'llama-3.3-70b-versatile',
  choices: [{ index: 0, finish_reason: finishReason, message }],
  usage: { prompt_tokens: 120, completion_tokens: 12 },
});

const jsonResponse = (body: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

/** Records what was sent, so the request shape can be asserted on. */
const recorder = (
  respond: () => Response,
): { fetch: FetchLike; sent: { url: string; init: RequestInit }[] } => {
  const sent: { url: string; init: RequestInit }[] = [];
  return {
    sent,
    fetch: (url, init) => {
      sent.push({ url, init });
      return Promise.resolve(respond());
    },
  };
};

const bodyOf = (sent: { init: RequestInit }[]): Record<string, unknown> => {
  const body = sent[0]?.init.body;
  if (typeof body !== 'string') throw new Error('no request was sent');
  return JSON.parse(body) as Record<string, unknown>;
};

/** Only `signal` is read by the adapter; the rest of a real turn's options are Core's. */
const withSignal = (signal: AbortSignal): PortOptions => ({ signal }) as unknown as PortOptions;

const model = (fetchImpl: FetchLike, options: Record<string, unknown> = {}): GroqLanguageModel =>
  new GroqLanguageModel({ apiKey: 'test-key', fetchImpl, ...options });

const tool = (): Tool =>
  ({
    id: 'calendar.createEvent',
    name: 'Create event',
    description: 'Adds an event to the calendar.',
    parameters: { type: 'object', properties: { title: { type: 'string' } } },
  }) as unknown as Tool;

describe('the request Groq receives', () => {
  it('leads with the system prompt, then the conversation in order', () => {
    const { fetch, sent } = recorder(() => jsonResponse(completion()));

    return model(fetch)
      .complete(
        request({
          messages: [
            { role: 'user', content: 'first' },
            { role: 'assistant', content: 'second', toolCalls: [] },
            { role: 'user', content: 'third' },
          ],
        }),
      )
      .then(() => {
        // The stable prefix must physically precede anything volatile, or no
        // prompt cache can ever match.
        expect(bodyOf(sent)['messages']).toStrictEqual([
          { role: 'system', content: 'You are Nexa.' },
          { role: 'user', content: 'first' },
          { role: 'assistant', content: 'second' },
          { role: 'user', content: 'third' },
        ]);
      });
  });

  it('carries the key, the model and the output ceiling', async () => {
    const { fetch, sent } = recorder(() => jsonResponse(completion()));

    await model(fetch, { model: 'openai/gpt-oss-120b' }).complete(request({ maxTokens: 256 }));

    const headers = sent[0]?.init.headers as Record<string, string>;
    expect(headers['authorization']).toBe('Bearer test-key');
    expect(sent[0]?.url).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect(bodyOf(sent)['model']).toBe('openai/gpt-oss-120b');
    expect(bodyOf(sent)['max_completion_tokens']).toBe(256);
  });

  it('offers no tools when there are none, rather than an empty list', async () => {
    const { fetch, sent } = recorder(() => jsonResponse(completion()));

    await model(fetch).complete(request());

    expect(bodyOf(sent)).not.toHaveProperty('tools');
  });

  it('sends tool results as tool messages, never as user prose', async () => {
    const { fetch, sent } = recorder(() => jsonResponse(completion()));

    await model(fetch).complete(
      request({
        messages: [
          { role: 'user', content: 'What is on today?' },
          {
            role: 'assistant',
            content: '',
            toolCalls: [
              { callId: 'call_1', toolId: 'calendar.list' as Tool['id'], arguments: { day: 'today' } },
            ],
          },
          { role: 'tool', results: [{ callId: 'call_1', content: 'Nothing.', isError: false }] },
        ],
      }),
    );

    // Flattening a tool result into user prose is how a transcript ends up
    // containing turns the person never took.
    expect(bodyOf(sent)['messages']).toStrictEqual([
      { role: 'system', content: 'You are Nexa.' },
      { role: 'user', content: 'What is on today?' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: { name: 'calendar.list', arguments: '{"day":"today"}' },
          },
        ],
      },
      { role: 'tool', tool_call_id: 'call_1', content: 'Nothing.' },
    ]);
  });

  it('states that a tool failed, since the protocol has no flag for it', async () => {
    const { fetch, sent } = recorder(() => jsonResponse(completion()));

    await model(fetch).complete(
      request({
        messages: [
          { role: 'tool', results: [{ callId: 'call_1', content: 'timed out', isError: true }] },
        ],
      }),
    );

    const messages = bodyOf(sent)['messages'] as { content: string }[];
    expect(messages[1]?.content).toBe('Tool failed: timed out');
  });

  it('describes tools in the shape the protocol expects', async () => {
    const { fetch, sent } = recorder(() => jsonResponse(completion()));

    await model(fetch).complete(request({ tools: [tool()] }));

    expect(bodyOf(sent)['tools']).toStrictEqual([
      {
        type: 'function',
        function: {
          name: 'calendar.createEvent',
          description: 'Adds an event to the calendar.',
          parameters: { type: 'object', properties: { title: { type: 'string' } } },
        },
      },
    ]);
  });
});

describe('reading a completion', () => {
  it('returns the text, the usage and the model that actually served it', async () => {
    const { fetch } = recorder(() => jsonResponse(completion()));

    const result = await model(fetch, { model: 'requested-model' }).complete(request());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.text).toBe('Hello. Good to hear from you.');
    expect(result.value.inputTokens).toBe(120);
    expect(result.value.outputTokens).toBe(12);
    expect(result.value.model).toBe('llama-3.3-70b-versatile');
    expect(result.value.refused).toBe(false);
    expect(result.value.toolCalls).toStrictEqual([]);
  });

  it('parses tool arguments, which arrive as a JSON string', async () => {
    const { fetch } = recorder(() =>
      jsonResponse(
        completion({
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'call_9',
              type: 'function',
              function: { name: 'calendar.createEvent', arguments: '{"title":"Dentist"}' },
            },
          ],
        }),
      ),
    );

    const result = await model(fetch).complete(request());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.toolCalls).toStrictEqual([
      { callId: 'call_9', toolId: 'calendar.createEvent', arguments: { title: 'Dentist' } },
    ]);
  });

  it('reports a refusal rather than an empty answer', async () => {
    const { fetch } = recorder(() =>
      jsonResponse(completion({ role: 'assistant', content: '' }, 'content_filter')),
    );

    const result = await model(fetch).complete(request());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Core treats a refusal as terminal. Passing it through as silence would
    // hide a policy outcome behind a companion that seemed to have nothing to say.
    expect(result.value.refused).toBe(true);
  });

  it('fails rather than reporting an empty completion as chosen silence', async () => {
    const { fetch } = recorder(() =>
      jsonResponse(completion({ role: 'assistant', content: '' }, 'length')),
    );

    const result = await model(fetch).complete(request());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain('empty completion');
    expect(result.error.retryable).toBe(true);
  });

  it('fails when a tool call carries arguments that are not JSON', async () => {
    const { fetch } = recorder(() =>
      jsonResponse(
        completion({
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'call_1',
              type: 'function',
              function: { name: 'calendar.createEvent', arguments: '{"title": ' },
            },
          ],
        }),
      ),
    );

    const result = await model(fetch).complete(request());

    // Defaulting to `{}` would run a zero-argument tool instead of reporting
    // that the model produced nonsense.
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain('not valid JSON');
  });

  it('fails when a 200 carries a body that is not JSON', async () => {
    const { fetch } = recorder(() => new Response('<html>gateway</html>', { status: 200 }));

    const result = await model(fetch).complete(request());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain('not JSON');
  });

  it('fails when the completion has no choices', async () => {
    const { fetch } = recorder(() => jsonResponse({ model: 'x', choices: [] }));

    const result = await model(fetch).complete(request());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain('no choices');
  });
});

describe('failures are classified by whether trying again could help', () => {
  it('treats a bad key as terminal, and says which variable to check', async () => {
    const { fetch } = recorder(() =>
      jsonResponse({ error: { message: 'Invalid API Key' } }, 401),
    );

    const result = await model(fetch).complete(request());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.retryable).toBe(false);
    expect(result.error.message).toContain('Invalid API Key');
    expect(result.error.message).toContain('GROQ_API_KEY');
  });

  it('treats an unknown model as terminal, and names the model asked for', async () => {
    const { fetch } = recorder(() =>
      jsonResponse({ error: { message: 'model not found' } }, 404),
    );

    const result = await model(fetch, { model: 'retired-model' }).complete(request());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.retryable).toBe(false);
    // A model that quietly left the catalogue is the most likely reason this
    // adapter ever breaks without a code change.
    expect(result.error.message).toContain('retired-model');
    expect(result.error.message).toContain('NEXA_MODEL_ID');
  });

  it('treats rate limiting as retryable and surfaces the wait', async () => {
    const { fetch } = recorder(() =>
      jsonResponse({ error: { message: 'rate limit reached' } }, 429, { 'retry-after': '7' }),
    );

    const result = await model(fetch).complete(request());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.retryable).toBe(true);
    expect(result.error.message).toContain('7');
  });

  it('treats a server error as retryable', async () => {
    const { fetch } = recorder(() => jsonResponse({ error: { message: 'upstream' } }, 503));

    const result = await model(fetch).complete(request());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.retryable).toBe(true);
  });

  it('treats a malformed request as terminal', async () => {
    const { fetch } = recorder(() => jsonResponse({ error: { message: 'bad field' } }, 400));

    const result = await model(fetch).complete(request());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.retryable).toBe(false);
  });

  it('reports an unreachable host as retryable, with the endpoint in the message', async () => {
    const fetch: FetchLike = () => Promise.reject(new Error('getaddrinfo ENOTFOUND'));

    const result = await model(fetch).complete(request());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.retryable).toBe(true);
    expect(result.error.message).toContain('api.groq.com');
  });
});

describe('timeouts and cancellation', () => {
  /** Never answers, but honours the signal — the shape of a hung provider. */
  const hangs: FetchLike = (_url, init) =>
    new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => {
        reject(new Error('aborted'));
      });
    });

  it('gives up on its own ceiling and calls that retryable', async () => {
    const result = await model(hangs, { timeoutMs: 20 }).complete(request());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.retryable).toBe(true);
    expect(result.error.message).toContain('did not answer within 20 ms');
  });

  it('aborts the request itself rather than only the wait', async () => {
    let observed: AbortSignal | undefined;
    const capture: FetchLike = (_url, init) => {
      observed = init.signal ?? undefined;
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          reject(new Error('aborted'));
        });
      });
    };

    await model(capture, { timeoutMs: 20 }).complete(request());

    // Stopping the wait without stopping the work leaves the connection held
    // and the quota spent.
    expect(observed?.aborted).toBe(true);
  });

  it('treats a cancelled turn as terminal, not as a timeout', async () => {
    const controller = new AbortController();
    const pending = model(hangs, { timeoutMs: 10_000 }).complete(
      request(),
      withSignal(controller.signal),
    );

    controller.abort();
    const result = await pending;

    expect(result.ok).toBe(false);
    if (result.ok) return;
    // Retrying a turn the caller abandoned spends money on an answer nobody wants.
    expect(result.error.retryable).toBe(false);
    expect(result.error.message).toContain('cancelled');
  });

  it('does not open a connection for a turn that is already cancelled', async () => {
    const { fetch, sent } = recorder(() => jsonResponse(completion()));
    const controller = new AbortController();
    controller.abort();

    const result = await model(fetch).complete(request(), withSignal(controller.signal));

    expect(sent).toHaveLength(0);
    expect(result.ok).toBe(false);
  });
});

describe('what the adapter claims it can do', () => {
  it('does not claim streaming it has not implemented', () => {
    const instance = model(() => Promise.resolve(jsonResponse(completion())));

    // Core checks the capability *and* the method. Claiming one without the
    // other is harmless only by accident.
    expect(instance.capabilities.streaming).toBe(false);
    expect((instance as { stream?: unknown }).stream).toBeUndefined();
  });

  it('names itself by the model actually bound', () => {
    const instance = model(() => Promise.resolve(jsonResponse(completion())), {
      model: 'llama-3.1-8b-instant',
    });

    expect(instance.name).toBe('groq:llama-3.1-8b-instant');
  });
});
