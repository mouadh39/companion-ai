# ADR-009 — The Agentic Loop Is Bounded And Confined To Generation

> Status: Accepted
> Date: 2026-07-30
> Affects: `@nexa/core`

## Context

Milestone 1's `ActionGenerator` made exactly one provider call. It could not use
a tool at all, so `call_tool` was a decision kind with nothing behind it.

The obvious alternative is the modern one: hand the model tools and let it drive
the whole interaction — Core becomes a tool host. That deserved a straight
answer rather than a dismissal.

| | Agentic-as-Core | Deterministic skeleton |
|---|---|---|
| Code | far less | more |
| Capability ceiling | higher | bounded by the skeleton |
| Explainability | reconstructed post-hoc | structural |
| Determinism | none | decision is pure |
| Latency / cost | unbounded | bounded, attributable |
| Replayable | no | yes |

For a general assistant, the agentic version wins. For a **companion** — a
persistent identity accumulating memory across years — it does not, because a
personality drift you cannot replay is one you cannot debug.

## Decision

**Hybrid: a deterministic skeleton with the agentic loop confined to stage 5.**

Context assembly, deliberation, validation and commit stay deterministic. Inside
generation, the model may call tools in a loop until it is done — bounded by
**three independent limits**:

| Limit | Guards against |
|---|---|
| `maxIterations` (4) | a model that asks forever |
| `maxTotalTokens` (32 k) | many cheap rounds |
| wall-clock deadline | few slow rounds |

Three, because each fails differently and any one alone leaves a hole:
iterations permit four very slow calls, a deadline permits a hundred fast ones,
and tokens permit an unbounded number of cheap ones.

Every limit **stops the loop and answers with what is in hand** rather than
failing. The model has usually produced prose alongside its tool request, and a
partial answer beats none. Each records a distinct diagnostic
(`tool_loop_exhausted`, `tool_loop_deadline`) so the three are distinguishable
after the fact.

### Tool selection is the model's, not Core's

The originally proposed pipeline had `Planning → Tool Selection → LLM`. That is
two reasoning systems disagreeing at the cost of a round trip: with a modern
model, tool selection *is* the model call. `ToolRegistryPort` contributes
*available* tools to context; the model selects; `ToolExecutionPort` runs them.

### Capability-gated

Tools are offered only when the model declares `capabilities.toolUse` **and** an
executor is configured **and** tools exist. A local model without tool use has
them withheld and a `model_capability_missing` diagnostic recorded — degradation,
which is the policy everywhere else. Without this, Core would offer tools, get
prose back, and the failure would surface as a companion that mysteriously never
uses its calendar.

### A failed tool goes back to the model

Not to the caller. A failed tool is information the companion can act on — "your
calendar is unreachable right now" is a better outcome than silence, and only the
model can phrase it. The turn fails only when the model itself fails or refuses.

### Streaming is a sink, not a return type

`TurnRequest.sink` receives tokens and, separately, actions. `run()` still
returns `Result<TurnResult, TurnFailure>`. Making it an `AsyncIterable` would
force tests, the worker and autonomous turns into an iteration protocol they
have no use for, and would make the failure type awkward to express.

## Consequences

**Good.** Tools work. Cost is attributable per turn because every call in the
loop lands in `TurnRecord.modelCalls`. A runaway model cannot turn one message
into an unbounded bill. The agentic capability is available where it pays,
without the auditability cost anywhere else.

**Costs.** Generation is now the most complex stage in the pipeline, and the
three limits interact — a turn can hit the deadline check *before* invoking a
tool it has time to call but not time to use the result of. That is deliberate
(running it anyway spends a side effect on an answer nobody sees) but it is
subtle, and it is the behaviour most likely to confuse someone reading a trace.

**Open.** Retry and provider fallback live in the adapter, not the loop. Core
owns the deadline; the adapter decides how to spend it. A `provider_fallback`
diagnostic code exists for adapters to report through, and nothing emits it yet.
