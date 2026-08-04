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
| `AnthropicLanguageModel` | Production. `claude-opus-5` at `effort: 'low'` for the latency-sensitive conversational turn, with server-side refusal fallback. |
| `ScriptedLanguageModel` | Tests and local development. Returns queued responses in order, so a turn test is deterministic and costs nothing. |

## Tests

No test directory. `ScriptedLanguageModel` is exercised throughout
`apps/backend`'s turn tests; the Anthropic adapter is covered by integration
tests that require a live key and are not part of `turbo run test`.
