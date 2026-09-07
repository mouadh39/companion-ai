# @nexa/providers

Language model implementations behind `LanguageModelPort`.

## Why the boundary exists

ADR-002 in one package: the companion's identity, memory, goals and personality
all live outside this seam, so swapping the implementation changes which model
writes the words and nothing else about who is speaking.

Every provider returns a `Result` rather than throwing — a provider failure is
an expected condition on a path that must degrade rather than fail.

## Implementations

| Provider | Use |
|---|---|
| `AnthropicLanguageModel` | `claude-opus-5` at `effort: 'low'` for the latency-sensitive conversational turn, with server-side refusal fallback. |
| `GroqLanguageModel` | Fast, inexpensive inference over the OpenAI chat-completions protocol. Default `llama-3.3-70b-versatile`. |
| `ScriptedLanguageModel` | Tests and local development. Returns queued responses in order, so a turn test is deterministic and costs nothing. |

### Why Groq uses `fetch` and Anthropic uses an SDK

Anthropic's adapter needs beta features — server-side refusal fallback, effort
control, prompt-cache accounting — and those are worth the coupling. Groq speaks
a small, flat, stable protocol, so an SDK would add a dependency, a second retry
policy layered under Core's deadline, and another error taxonomy to translate,
for a request that fits in one object.

Both adapters share the rule that matters: a provider failure is a `Result`,
never an exception, and it carries whether trying again could help. Terminal
failures — a bad key, a retired model, a malformed request — are not retried,
because they will fail identically on the second attempt.

## Tests

`test/groq.test.ts` covers the Groq adapter with an injected `fetch`: request
shape, response mapping, tool-call parsing, error classification, timeouts and
cancellation. No key, no network, no spend.

`ScriptedLanguageModel` is exercised throughout `apps/backend`'s turn tests. The
Anthropic adapter is covered by integration tests that require a live key and
are not part of `turbo run test`.
