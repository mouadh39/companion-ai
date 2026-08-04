# Data Flow

> Version: 1.0
> Status: Accepted
> Applies to: Milestone 1 onward

---

# Purpose

This document defines what happens between a user message arriving and actions
leaving — the **cognitive turn** — and, equally important, what deliberately
does *not* happen inside it.

---

# The governing decision: two paths, not one

Nexa has exactly two kinds of flow, and confusing them is the most expensive
mistake available at this stage.

| | Synchronous path | Asynchronous path |
|---|---|---|
| **What** | The cognitive turn | Reactions and consolidation |
| **Shape** | Ordered pipeline with return values | Event fan-out |
| **Runs in** | `apps/backend` | `apps/worker` |
| **Latency budget** | Bounded, user-visible | Unbounded, invisible |
| **Failure** | Surfaces to the user now | Retries with backoff |
| **Ordering** | Guaranteed | Not guaranteed |

## Why the turn is not event-driven

The project principle says everything communicates through events. Applied to
the cognitive turn, that principle does real damage, for three reasons:

1. **The turn is inherently ordered and needs return values.** You cannot
   assemble a prompt before retrieving memories, and retrieval must *return*
   them. Expressing that as events means inventing correlation IDs and a
   response-waiting mechanism — a synchronous call reimplemented badly.
2. **It destroys explainability.** `10_Decision_Engine.md` requires every
   decision to be explainable. Explanation comes from the call tree: this
   context, these memories, therefore this decision. Event indirection replaces
   the tree with a log you must reconstruct causality from.
3. **It makes latency unpredictable.** A user-facing path needs a bounded,
   measurable budget. Queue depth is not a budget.

Events remain exactly right for what follows the turn: memory writes,
reflection triggers, relationship updates, telemetry, client push. Those are
unordered, retryable, and nobody is waiting.

This is CQRS in its useful form: **the turn is a command, everything downstream
is a projection.**

---

# The cognitive turn

```
  Client message
        │
        ▼
┌───────────────────┐
│ 1  Ingress        │  Authenticate. Validate. Resolve companion identity.
└─────────┬─────────┘
          ▼
┌───────────────────┐
│ 2  Perception     │  Normalise input. Classify intent. Detect emotion signal.
└─────────┬─────────┘
          ▼
┌───────────────────┐
│ 3  Context        │  ─── the only stage that performs I/O ───
│    Assembly       │  Gather from ports, in parallel, under a token budget:
│                   │    identity · personality · working memory
│                   │    retrieved memories · goals · relationship
│                   │    emotion · world state · available tools
└─────────┬─────────┘
          ▼
   CognitiveContext          ← immutable, complete, serialisable
          │
          ▼
┌───────────────────┐
│ 4  Deliberation   │  PURE. (CognitiveContext) → Decision
│                   │  No I/O. No clock. No randomness.
└─────────┬─────────┘
          ▼
     Decision                ← what to do, why, confidence, alternatives
          │
          ▼
┌───────────────────┐
│ 5  Generation     │  Decision → Action[]
│                   │  Calls the model provider when language is required.
└─────────┬─────────┘
          ▼
┌───────────────────┐
│ 6  Validation     │  Schema, safety, permissions, action budget.
└─────────┬─────────┘
          ▼
┌───────────────────┐
│ 7  Commit         │  Update working memory. Emit domain events. Respond.
└─────────┬─────────┘
          ▼
     Action[] ──────▶ client executes
          │
          ╰─── events ───▶ asynchronous path
```

## Stage contracts

**1 — Ingress.** Turns an HTTP request into a `TurnRequest`. Owns
authentication and rate limiting. Knows nothing about cognition.

**2 — Perception.** Produces a `Perception`: normalised text, intent
candidates, an emotion signal, and referenced entities. Cheap and local
wherever possible; a model call here is on the critical path twice over.

**3 — Context Assembly.** The **only** stage permitted to perform I/O. It
queries every port — in parallel, since they are independent — and returns one
immutable `CognitiveContext`.

Concentrating I/O in one stage is deliberate. It gives a single place to
enforce the token budget, a single place to parallelise, a single place to
apply timeouts, and it is what allows the next stage to be pure.

**4 — Deliberation.** A pure function from `CognitiveContext` to `Decision`.
No I/O, no clock reads, no randomness — anything time- or entropy-dependent
arrives inside the context.

This is the most important constraint in the document. Purity gives:

- **snapshot tests** over reasoning itself
- **replay**: any production decision re-runs offline from its logged context
- **genuine explainability**, because the inputs are captured by construction
- **no flakes**, because the same context always yields the same decision

If deliberation needs information it does not have, that is a bug in Context
Assembly, never a reason to reach out from stage 4.

**5 — Generation.** Expands a `Decision` into concrete `Action[]`. This is
where the model provider is called, and the only stage that produces language.

**6 — Validation.** Rejects malformed, unsafe, or unpermitted actions before
they reach a client. A client must never be the first thing to discover an
action is invalid.

**7 — Commit.** Updates working memory, emits events, returns the response.
Long-term memory writes are *events*, not synchronous writes — the user should
not wait on consolidation.

---

# CognitiveContext and the context budget

`CognitiveContext` is the single input to deliberation and the single source
for prompt construction.

```
CognitiveContext
├── turnId, companionId, userId, timestamp
├── perception          intent, emotion signal, entities
├── identity            immutable core identity
├── personality         traits + adaptive state
├── workingMemory       current session
├── retrievedMemories   ranked, with scores and reasons
├── goals               active only
├── relationship        trust, familiarity, preferences
├── emotion             companion state + estimated user state
├── world               location, device, time, environment
├── tools               available and permitted
└── budget              per-section token allocation and what was dropped
```

## Why the budget is in the model from day one

Assembled naively, this context is 10–30k tokens per turn. At millions of users
that is simultaneously the largest cost line and the largest latency
contributor in the system.

The budget is therefore **part of the context, not a post-processing step**:

- every section declares a token ceiling
- sections fill in priority order
- what gets dropped is *recorded* in `budget`, so a thin answer is explainable
  rather than mysterious
- the total is asserted before the provider call

Retrofitting this once nine engines are all writing into the prompt means
touching all nine. Building it in now costs a struct field.

---

# Memory retrieval

Retrieval is a scoring problem, not a similarity lookup.
`18_Memory_Architecture.md` already states that no single signal should
dominate, which makes the scorer a first-class, independently testable unit:

```
candidates ──▶ score(memory, context) ──▶ rank ──▶ budget-limited top-k
```

Signals: semantic similarity, recency, importance, goal relevance, emotional
salience, relationship relevance, access frequency.

Two consequences worth stating explicitly:

- the scorer takes `CognitiveContext`, so it can be tested against fixtures
  with **zero** infrastructure
- returned memories carry their score *and the reason they scored*, which flows
  into the decision trace and out into explainability

---

# The asynchronous path

```
  domain events
        │
        ▼
┌───────────────────┐
│ Event transport   │  Redis streams. At-least-once.
└─────────┬─────────┘
          ▼
┌───────────────────┐
│ apps/worker       │
├───────────────────┤
│ memory writer     │  candidate memory → importance → persist → embed
│ reflection        │  periodic: experiences → insights
│ consolidation     │  merge duplicates, decay, forget
│ relationship      │  slow-moving trust and familiarity updates
│ goals             │  progress, blocked detection, replanning
│ scheduler         │  autonomous behaviour at appropriate times
└───────────────────┘
```

Handlers must be **idempotent**. Transport is at-least-once, so every handler
is keyed on `event.id` and a redelivery is a no-op. This is cheaper to build
now than to diagnose later as duplicated memories — a failure mode
`18_Memory_Architecture.md` already lists as a risk.

---

# Latency budget

A rough target for a typical turn, to make regressions visible:

| Stage | Target | Notes |
|---|---|---|
| Ingress + Perception | < 20 ms | local |
| Context Assembly | < 120 ms | parallel; vector search dominates |
| Deliberation | < 5 ms | pure computation |
| Generation | 500–2500 ms | provider-bound |
| Validation + Commit | < 20 ms | events are fire-and-forget |

Everything Nexa controls is under ~165 ms. The provider dominates, which is why
adding network hops inside assembly is the change most likely to make the
system feel slow, and why the modular monolith matters more than it appears to.

---

# Failure handling

| Failure | Behaviour |
|---|---|
| A context port times out | Proceed without that section; record the omission in `budget`. A turn must never fail because the world model was slow. |
| Provider fails | Retry with backoff, then fail over to the next configured provider. |
| All providers fail | Return a degraded but honest action. Never fabricate. |
| Validation rejects an action | Drop it, log it, return the remainder. |
| Event emission fails | Log and continue. The turn already succeeded; events are not part of its contract. |

The principle: **a turn degrades rather than fails.** Partial context yields a
thinner answer, not an error page — and because omissions are recorded, the
companion can say it is missing something rather than guessing.

---

# Milestone 1 scope

Implemented: all seven stages, with Context Assembly reading only identity,
personality and in-memory working memory; the Deliberator handling a small
decision set; Generation calling one real provider.

Stubbed behind real ports: retrieved memories, goals, relationship, emotion,
world, tools. Each returns empty and is replaced by a capability package later
without the pipeline changing.

Events are emitted to an in-process bus. No worker yet.

---

# References

03_Companion_Core.md
04_System_Architecture.md
06_Event_System.md
09_Conversation_Engine.md
10_Decision_Engine.md
18_Memory_Architecture.md
