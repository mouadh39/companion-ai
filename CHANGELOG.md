# Changelog

All notable changes to Nexa are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] — 2026-07-31 — Nexa Cognitive Core

The first release. It establishes the cognitive turn, the ports it depends on,
and the execution policy every stage shares — the backend architecture that the
memory, personality, planning, emotion and world engines will be built against.

Nothing in this release depends on a rendering client, and nothing in it depends
on a specific language model.

`0.x` is deliberate. The architecture is stable enough to build against, and the
seven known limitations at the end of this entry are the reason it is not yet
`1.0`: each is a named seam with a planned replacement, and filling them will
change interfaces.

### Execution pipeline

- **One synchronous, ordered pass** from a message arriving to actions leaving:
  `admission → perception → context assembly → deliberation → generation →
  validation → commit → publish`.
- The turn **emits** events; it is not built out of them. Expressing it as an
  event chain would mean inventing correlation ids and a response-waiting
  mechanism — a synchronous call reimplemented badly — and would destroy the
  call tree explainability depends on. Everything downstream of the turn is a
  projection over what it publishes.
- **Ports are tiered by latency path**, not by owning engine: Tier 1 context
  (parallel, budgeted, degradable, side-effect free), Tier 2 generation
  (sequential, recoverable then turn-fatal), Tier 3 egress (runs after the
  answer exists, so it can never fail a turn). The tier determines timeout
  policy, failure policy, and whether a failure may be degraded — grouped by
  owning engine, those three answers get re-derived per port and drift apart.
  See ADR-006.
- **Deadlines, not timeouts.** One `Deadline` owns the whole turn and every
  stage receives a *subdivision* that can never outlive its parent. A fixed
  per-port timeout composes badly: under load, assembly could spend its full
  allowance once per port and still return nothing, and no constant has any
  relationship to what the caller was willing to wait for. See ADR-008.
- **Cancellation is a real `AbortSignal`**, not an abandoned promise. Racing a
  timer stops the *waiting* but not the work — the connection stays held and the
  provider quota stays spent.
- **`callPort` is the single entry point** for invoking a port, and it never
  throws. A port failing is expected on a path required to degrade, so the
  failure returns as a value and the call site decides whether it costs a
  thinner answer or the turn. `not_attempted` stays distinct from `timeout`: the
  first indicts everything that ran before, the second indicts the port.
- Dependency inversion end to end — `@nexa/core` declares every port and imports
  no capability package. `apps/backend/src/composition.ts` is the only place in
  the system that names a concrete implementation.

### Admission gate

Stage 0. Three cheap checks, each preventing a different silent corruption:

- **Deadline check** — an expired turn spends a provider call nobody will read.
- **Idempotency** — `InMemoryIdempotencyStore` replays a retried request
  verbatim, including the original turn id. A retry that produced a *new* id
  would defeat the purpose: the client could not tell the two responses referred
  to one exchange.
- **Per-companion gate** — `InProcessTurnGate` serialises turns for one
  companion, FIFO within it, so concurrent turns cannot interleave their writes
  to working memory. Two users never wait on each other.

Both implementations are correct for a single API process and do not pretend
otherwise; each is the seam a distributed lease and a shared store slot into.

### Contributor dependency graph

- Contributions **declare their dependencies** and are sorted into waves at
  construction; each wave runs in parallel and only genuine dependents wait.
- The shape this replaces encoded the goals→retrieval edge in the *order of two
  statements* — fine for one edge, a trap at six, where a contributor added to
  the wrong phase reads an empty dependency and nothing fails.
- A cycle or a missing dependency is a **boot failure with a named cause**, not
  a turn that silently reads nothing.
- A dependent is told **why** a dependency is missing (`view.outcomeOf(GOALS)`),
  not merely handed an empty value — "there are no goals" and "the goal service
  timed out" call for different behaviour.
- Contributor keys are exported, so a capability package can declare a
  dependency without importing the assembler that builds it.

### Cognitive context

- The single input to deliberation, assembled by the **only stage permitted to
  perform I/O**. That concentration gives one place to enforce the token budget,
  one place to schedule, one place to apply deadlines — and it is what allows
  the next stage to be a pure function.
- **Per-section token budgeting.** Working memory truncates newest-first,
  because in a conversation the last exchange is almost always the most
  load-bearing. Retrieved memories are walked in rank order and never re-ranked
  — two independent rankings of one set is how a system loses the ability to
  explain why a memory surfaced.
- **Every omission carries a reason** — `empty`, `timeout`, `port_error`,
  `budget_exceeded`, `not_attempted`.
- **Absent is not degraded.** A capability never composed in contributes nothing
  and records nothing. A companion with no world model is not a degraded
  companion; it is one without that faculty. Marking it degraded would flag
  every turn until every engine ships and destroy the one metric tracking
  quality in a system built to fail quietly.
- **Deliberately not a blackboard.** No write-back, no opportunistic
  re-triggering. Write-back would make the decision a function of the *sequence
  of writes* rather than of a value, so replay would have to reproduce the
  interleaving; opportunistic control would make identical inputs yield
  different decisions depending on which contributor won a race, and would leave
  the turn no upper bound on a path a user is waiting on. See ADR-007.

### Deliberation

- **`deliberate(context)` is pure** — no I/O, no clock, no randomness. The
  decision id is stamped by the caller precisely so purity holds.
- Every decision carries **`reasonCodes`, `alternatives` and `groundedIn`**, so
  explainability is structural rather than reconstructed after the fact.
- **The decision hint.** When rule-based deliberation stops sufficing, the
  obvious fix — calling a model inside `deliberate()` — would destroy purity and
  everything built on it. Instead `DecisionAdvisorPort` runs in the *last
  assembly wave* and its opinion arrives as an ordinary context field, so a
  model participates in deciding without costing replay or determinism.
- The hint stays advisory: consulted **only** where the rules were already
  unsure, ignored below `MIN_ACTIONABLE_HINT_CONFIDENCE`, never able to suggest
  `stay_silent` (an advisor that can silence the companion can make it
  unresponsive through one bad model call, and silence is the one outcome a user
  cannot distinguish from a fault), and never lending its own confidence to the
  decision.
- Optional by construction — with no advisor composed in, deliberation runs on
  its rules alone and nothing else changes.

### Bounded tool loop

- The agentic loop lives in generation and nowhere else, **bounded three ways**:
  iterations, wall clock, and cumulative tokens. Three, because each fails
  differently and any one alone leaves a hole — iterations permit four very slow
  calls, a deadline permits a hundred fast ones, tokens permit an unbounded
  number of cheap ones. See ADR-009.
- Every limit stops the loop and **answers with what is in hand** rather than
  failing, recording a distinct diagnostic. The model has usually already
  produced prose alongside its tool request, and a partial answer beats none.
- **A failed tool goes back to the model** rather than ending the turn — the
  companion can say the calendar is unreachable, and only the model can phrase
  that.
- Independent tool calls run concurrently: a model asking for three lookups pays
  for the slowest, not the sum.
- **Capability gating.** Tools are offered only when the model supports tool use
  *and* an executor is composed *and* tools exist. A model without tool use gets
  a diagnostic and a skipped loop rather than prose Core cannot act on.
- Tool selection is the model's, not Core's. Pre-selecting tools and then asking
  the model is two reasoning systems disagreeing at the cost of a round trip.

### Capability registry

- `CapabilityModule` is a plugin **descriptor**, not a plugin **loader**.
  Filesystem scanning and dynamic `import()` would buy discovery at the cost of
  the property enforced on both sides of this codebase — the composition root is
  the single place a concrete implementation is named.
- `planInitOrder` resolves initialisation order from declared port dependencies;
  `bootCapabilities` produces the same `PortMap` the composition root builds by
  hand today.
- Every registry failure is a **boot failure with a named cause** rather than a
  null dereference on turn four hundred: a dependency cycle, a missing provider,
  two modules claiming one port, or a module that did not deliver what it
  declared.

### Streaming

- Streaming is a **sink the caller supplies** (`TurnRequest.sink`), not a change
  to `run()`'s return type. An `AsyncIterable` would force tests, the worker and
  autonomous turns into an iteration protocol they have no use for.
- `LanguageModelPort.stream` is optional and resolves to the same
  `CompletionResult` that `complete` does — streaming changes *when* the caller
  learns the answer, never *what* the answer is. A provider without it simply
  omits it, and generation falls back with no other change.
- Actions reach the sink **after** capability filtering, never before: a client
  must not be handed an action it cannot execute and then told to forget it.

### Replay

- `TurnRecord` captures stage timings, every port call and its outcome, model
  calls with token counts, the decision with its reason codes, rejected actions
  with reasons, omissions, and diagnostics.
- **The record is present on failure too**, and that is the point: a turn that
  failed is the one you most need the timings and port outcomes for. Calls made
  before a fatal section failed are carried on the error rather than lost.
- Because deliberation is pure and the hint is **recorded rather than
  re-requested**, any production decision can be replayed offline from its
  logged context and will produce the same result.
- **`TurnRecord` is separate from `CognitiveContext`.** The context holds only
  what may legitimately change the decision. If cost were reachable from the
  context it would be an input to `deliberate()`, and the same context would
  stop producing the same decision across environments where those measurements
  differ. Nothing that reasons ever reads the record.

### Observability

- `Metrics`, `Tracer` and `Logger` contracts with no-op defaults, so nothing in
  Core requires an observability backend to run.
- **Metrics are derived from `TurnRecord`** rather than instrumented in a dozen
  places, which keeps every measurement consistent with what was recorded and
  means a new stage is measured the moment it is timed.
- The turn is reported **exactly once however it ends**, from a wrapper outside
  the pipeline — the pipeline returns from a dozen places, and a metric emitted
  at each is one that eventually gets missed at one.
- **`nexa_turn_degraded_total` is the headline quality signal, not error rate.**
  A system designed to degrade shows ~0% errors while quietly getting worse.
- Cached prompt tokens get their own series: without it, a prompt reordering
  that silently defeats the provider cache shows up as a bill rather than as a
  metric.
- **Labels are deliberately low cardinality** — never a user id, never a
  companion id, never a message. A metrics backend charges by series, and one
  label carrying a user id turns a handful of series into one per user.

### Documentation

- Four new ADRs: **ADR-006** (ports tiered by latency path), **ADR-007**
  (`CognitiveContext` is the shared cognitive state; no blackboard), **ADR-008**
  (one deadline per turn, subdivided; cancellation is real), **ADR-009** (the
  agentic loop is bounded and confined to generation).
- A README for every package, stating its boundary and the reasoning behind it.
- The root README now describes the actual system — a TypeScript monorepo with a
  provider-agnostic core — rather than the stack from an abandoned early plan.

### Fixed

- **The test suite ran zero tests for three milestones.** Root-relative globs in
  a single root Vitest config were re-rooted by Turborepo's per-package working
  directory, so every package reported "No test files found" and
  `--passWithNoTests` turned each of those honest misses into a success — 13/13
  tasks green, nothing executed. Configuration is now per package with
  package-relative globs (`vitest.base.ts` + `packages/*/vitest.config.ts`),
  which makes that failure impossible: a package either has tests under `test/`
  and runs them, or genuinely has none.
- Tests now resolve through each package's `exports` map and run against **built
  output**, so a test exercises exactly what other packages import rather than a
  source-only reality where the published entry point is never checked.

### Removed

Found during release review, before any release existed — so no consumer could
have depended on them:

- **`DomainEvent` from `@nexa/models`.** It collided by name with the live
  `DomainEvent` union in `@nexa/events` while describing a different shape, and
  nothing constructed or read it. `@nexa/events` owns `EventEnvelope`, which
  carries the `source`, `durability` and `causedBy` fields only the bus can
  stamp. `EventAggregate` and `aggregateOf` remain in `@nexa/models`.
- **`TURN_METRICS.toolCalls`**, a metric name nothing emitted. Every tool
  invocation already appears as a `tool:`-prefixed `nexa_port_duration_seconds`
  series carrying both outcome and latency.
- Dead parameters in `CognitiveTurn.#execute` and the tool loop's `finish`, and
  a redundant re-export shadowed by an adjacent `export *`.

### Known limitations

Intentional, and deferred with the reasoning recorded rather than forgotten.
Each is a seam with a named replacement, not a gap discovered late — and
collectively they are why this is `0.1.0` and not `1.0.0`.

- **No transactional outbox.** Events are published in-process after commit; a
  crash between the two loses them.
- **Admission is single-process.** `InProcessTurnGate` does not serialise across
  replicas.
- **Idempotency is in-memory.** Keys do not survive a restart and are not shared
  between replicas.
- **No provider fallback.** A provider failure fails the turn's generation stage
  rather than trying a second provider.
- **`PlanRevisionPort` is unimplemented.** Plans are read-only within a turn;
  revision belongs in the worker.
- **Identity is not cached.** Stable and cacheable; re-read every turn.
- **Personality is not cached.** Same.

Beyond those: the event catalogue declares fourteen domains and most have no
producer yet — those types are the contract the engines will be built against.
The adapters in `apps/backend/src/adapters/` are deliberate placeholder wiring,
each graduating into its own package as it becomes real.

[0.1.0]: https://github.com/mouadh39/companion-ai/releases/tag/v0.1.0
