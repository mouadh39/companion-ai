# @nexa/core

The cognitive turn, the ports it depends on, and the execution policy every
stage shares.

Core is the orchestration layer. It owns no engine: not the model, not memory,
not planning, not personality. It coordinates them through interfaces it
declares itself.

## The dependency rule

Core **declares** the ports; capability packages **implement** them; only
`apps/backend` names a concrete implementation. Core never imports a capability.

The alternative — Core importing each capability — makes Core a hub that must
change whenever any capability changes, and impossible to test without standing
up the entire system.

## Port tiers

Ports are grouped by their relationship to the turn's latency path, not by which
engine owns them. That relationship is what determines timeout policy, failure
policy, and whether a failure may be degraded; grouped by owning engine, those
three answers get re-derived once per port and drift apart.

| Tier | Ports | Policy |
|---|---|---|
| **1 · context** | Identity\*, Personality\*, WorkingMemory, MemoryRetrieval, Goals, Tools, World°, Emotion°, Relationship°, PlanRead°, DecisionAdvisor° | parallel, budgeted, degradable (\* = fatal, ° = optional) |
| **2 · generation** | LanguageModel, TokenEstimator | sequential, recoverable then turn-fatal |
| **3 · egress** | MemoryWrite | after the answer exists; can never fail a turn |

Optional ports are optional **by capability**, not by preference. A port that is
not composed in contributes nothing and records nothing — no call, no omission,
no degradation. A companion with no world model is not a degraded companion; it
has no such faculty. A port that *is* composed in and then fails does degrade
the turn.

Tier 1 ports must be free of side effects: they run under a race that can
abandon a slow result, so a Tier 1 port that writes is a port that writes
non-deterministically.

**Voice and vision are deliberately absent.** They sit outside the turn — speech
recognition produces the request, synthesis renders the response, and vision
writes into the world model asynchronously. A port for either would make Core
aware of the client's output modality, which is the coupling this design exists
to prevent.

## The turn is synchronous

The turn is a pipeline that *emits* events; it is not built out of them. It
needs return values and ordering, and event-driving it would mean reinventing
correlation IDs and response-waiting while destroying the call tree that
explainability depends on. Events are for what happens *after* the turn.

## `deliberate()` is pure

No I/O, no clock, no randomness. The decision *id* is stamped by the caller
precisely so purity holds. That buys snapshot-testable reasoning, offline replay
of any production decision from its logged context, and explainability that is
structural rather than reconstructed.

If deliberation appears to need data it lacks, that is a bug in
`ContextAssembler` — the only stage permitted to do I/O.

## Deadlines, not timeouts

One `Deadline` owns the whole turn. Every stage receives a *subdivision* of it,
and a child can never outlive its parent (`Deadline.subdivide`). A fixed
per-port timeout composes badly: under load, assembly could spend its full
allowance once per port and still return nothing, and no constant has any
relationship to what the caller was actually willing to wait for.

Cancellation is a real `AbortSignal`, not an abandoned promise. Racing a timer
stops the *waiting* but not the work — the connection stays held and the
provider quota stays spent.

`callPort` is the single entry point for invoking a port. It never throws:
a port failing is expected on a path required to degrade, so the failure comes
back as a value and the caller decides at the call site whether it costs a
thinner answer or the turn.

`not_attempted` is distinct from `timeout` on purpose. The first indicts
everything that ran before this port; the second indicts the port. Collapsing
them sends you optimising a dependency that was never slow.

## Context assembly is a declared graph

Contributions declare their dependencies and are sorted into waves at
construction; each wave runs in parallel. A cycle or a missing dependency is a
**boot failure with a named cause**, not a turn that silently reads nothing.

`CognitiveContext` is the shared cognitive state — one immutable structure every
engine contributes into and deliberation reads once. What the graph adds is
scheduling, and only scheduling. There is no write-back and no opportunistic
re-triggering, which is what separates this from a classical blackboard:

- **Write-back** would make the decision a function of the *sequence of writes*
  rather than of a value, and replay would have to reproduce the interleaving.
- **Opportunistic control** would make identical inputs yield different
  decisions depending on which contributor won a race, and would give the turn
  no upper bound on a path a user is waiting on.

A dependent is told *why* a dependency is missing (`view.outcomeOf(GOALS)`), not
merely handed an empty value — "there are no goals" and "the goal service timed
out" call for different behaviour.

## The decision hint

When rule-based deliberation stops sufficing, the obvious fix — call a model
inside `deliberate()` — would destroy purity and everything built on it. So the
advisor runs in the **last assembly wave** and its opinion arrives as an
ordinary `CognitiveContext` field. Deliberation stays a pure function; the input
merely got smarter, and replay works because you replay against the *recorded*
hint rather than re-asking the model.

The hint is advisory and stays that way:

- consulted **only** where the rules were unsure and would have asked a
  clarifying question — a hint that could override a confident rule would make
  the rules decorative;
- ignored below `MIN_ACTIONABLE_HINT_CONFIDENCE`;
- never able to suggest `stay_silent`, because an advisor that can silence the
  companion can make it unresponsive through one bad model call, and silence is
  the one outcome a user cannot distinguish from a fault;
- never lends its own confidence to the decision — the rules were unsure, and
  the advisor's certainty is not evidence that they should not have been.

## `degraded` excludes `empty`

A section that had nothing to say was not lost. Counting `empty` omissions pins
the degradation ratio at ~100% and the signal tracks nothing — which matters
most in a system deliberately built to fail quietly. The full omission list,
`empty` entries included, is still on `budget.omissions`.

## Admission is stage 0

Three cheap checks, each preventing a different silent corruption: an expired
turn spends a provider call nobody will read, a retried request runs every side
effect twice, and concurrent turns for one companion interleave their writes to
working memory. The gate is per companion — two users must never wait on each
other — and FIFO within one.

`InProcessTurnGate` and `InMemoryIdempotencyStore` are correct for a single API
process and do not pretend otherwise. Both are the seam a distributed lease and
a shared store slot into.

## The tool loop is bounded three ways

Generation is the only stage that produces language and the only one that calls
a provider. The agentic loop lives here and nowhere else, bounded by
**iterations**, **wall clock**, and **cumulative tokens** — three, because each
fails differently and any one alone leaves a hole: iterations permit four very
slow calls, a deadline permits a hundred fast ones, tokens permit an unbounded
number of cheap ones.

Every limit stops the loop and *answers with what is in hand* rather than
failing, and records a distinct diagnostic. A failed tool goes back to the model
rather than ending the turn — the companion can say the calendar is unreachable,
and only the model can phrase that.

Tool selection is the model's, not Core's. Pre-selecting tools and then asking
the model is two reasoning systems disagreeing at the cost of a round trip.

## Capabilities are registered, not discovered

`CapabilityModule` is a plugin *descriptor*, not a plugin *loader*. Filesystem
scanning and dynamic `import()` would buy discovery at the cost of the property
this codebase enforces on both sides — the composition root is the single place
a concrete implementation is named. Every registry failure (cycle, missing
provider, two modules claiming a port, a module that did not deliver what it
declared) is a **boot failure with a named cause** rather than a null
dereference on turn four hundred.

## `TurnRecord` is separate from `CognitiveContext`

The context holds only what may legitimately change the decision. Everything
*measured about* the turn — stage timings, port outcomes, token counts,
diagnostics — lives on `TurnRecord`. If cost were reachable from the context it
would be an input to `deliberate()`, and the same context would stop producing
the same decision across environments where those measurements differ.

Nothing that reasons ever reads the record. It exists for explaining, alerting,
and replaying after the fact.

## Tests

| File | What it holds |
|---|---|
| `deliberator.test.ts` | The pure decision function. No clock, no I/O, nothing to stub — the return on making the stage pure. |
| `execution.test.ts` | Deadline arithmetic and cancellation. A child that outlives its parent, or a timeout that stops the waiting but not the work, would be invisible in normal operation and catastrophic under load. |
| `turn-record.test.ts` | The audit artifact, and that it never leaks into the reasoning. |
| `context-graph.test.ts` | The scheduler: wave ordering, cycle detection, dependency visibility. |
| `assembler-graph.test.ts` | The *production* graph's shape, and that an uncomposed capability costs nothing while a failed one degrades. |
| `decision-hint.test.ts` | The advisory boundary — the hint may break a tie, never override a confident rule. |
| `admission.test.ts` | Per-companion serialisation and retry replay. Both prevent corruption that looks correct in any single turn's logs. |
| `tool-loop.test.ts` | The three limits, capability gating, and that a failed tool degrades rather than fails. |
| `capability.test.ts` | Boot ordering, and that every registry failure is named at startup. |
| `observability.test.ts` | Metrics derived from the record, and that no metric is ever labelled with a user. |

## Related decisions

- **ADR-006** — ports are tiered by latency path, not by owning engine
- **ADR-007** — `CognitiveContext` is the shared cognitive state; no blackboard
- **ADR-008** — one deadline per turn, subdivided; cancellation is real
- **ADR-009** — the agentic loop is bounded and confined to generation
