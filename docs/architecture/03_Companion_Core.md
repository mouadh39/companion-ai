# Companion Core

> Version: 1.0
> Status: Draft

---

# Purpose

Companion Core is the central intelligence of Companion AI.

It is responsible for every cognitive function of the companion, including:

- Conversation
- Memory
- Personality
- Planning
- Decision Making
- Reflection
- Goals
- Relationships
- World Understanding
- Tool Usage

Companion Core is completely independent of Unity, AR Foundation, or any specific client application.

---

# Design Goals

The Companion Core must:

- remain platform independent
- support multiple client applications
- survive LLM upgrades
- maintain a persistent identity
- continuously learn
- remain modular
- be highly testable
- support autonomous behaviors
- scale over years of user interaction

---

# High-Level Architecture

```
                           Companion Core
                                   │
        ┌───────────────┬──────────┴──────────┬───────────────┐
        │               │                     │               │
 Conversation      Memory Engine      Personality      World Model
        │               │                     │               │
        └───────────────┼──────────────┬──────┘
                        │              │
                 Decision Engine   Planning Engine
                        │
                  Action Generator
                        │
                   Tool Manager
                        │
                External Services
```

---

# Core Components

## Conversation Engine

Responsible for:

- understanding user messages
- maintaining dialogue
- conversation context
- response generation
- conversation history

Owns:

- active conversation
- temporary context

Never stores long-term memory.

---

## Memory Engine

Responsible for:

- memory retrieval
- memory storage
- memory ranking
- memory consolidation
- forgetting
- summarization

Owns:

- episodic memory
- semantic memory
- procedural memory
- relationship memory

---

## Personality Engine

Responsible for:

- communication style
- humor
- curiosity
- confidence
- empathy
- consistency

The Personality Engine should influence every response but never replace reasoning.

---

## Emotion Engine

Responsible for interpreting emotional context.

Examples:

- frustration
- excitement
- confidence
- uncertainty
- stress
- happiness

Emotion affects planning and conversation but does not directly control decisions.

---

## Relationship Engine

Tracks the relationship between Companion and the user.

Examples:

- trust
- familiarity
- shared experiences
- communication preferences
- interaction history

Relationship changes gradually over time.

---

## Planning Engine

Responsible for long-term thinking.

Examples:

- project planning
- reminders
- task sequencing
- scheduling
- autonomous suggestions

Planning should consider:

- user goals
- deadlines
- previous work
- available tools

---

## Decision Engine

The brain of Companion Core.

Every action passes through the Decision Engine.

Examples:

Should I answer?

Should I ask a question?

Should I search memory?

Should I call a tool?

Should I remain silent?

Should I create a reminder?

Should I notify the user?

The Decision Engine never generates language.

It decides what should happen.

---

## Reflection Engine

Runs in the background.

Purpose:

Transform experiences into knowledge.

Examples:

Today's conversations

↓

Interesting patterns

↓

Useful long-term memories

↓

Behavior improvements

Reflection should happen periodically and should not interrupt the user.

---

## World Model

Stores everything Companion knows about the environment.

Future examples:

Room layout

Furniture

Objects

Devices

User location

Frequently used places

The World Model is separate from Unity.

Unity observes the world.

Companion Core understands it.

---

## Goal Engine

Tracks:

Short-term goals

Long-term goals

Completed goals

Abandoned goals

Priority

Dependencies

Goals influence planning and memory retrieval.

---

## Tool Manager

Responsible for interacting with external capabilities.

Examples:

Calendar

Email

Browser

Camera

Music

Maps

Weather

Smart Home

Future tools can be added without changing Companion Core.

---

# Information Flow

```
User

↓

Conversation

↓

Decision Engine

↓

Memory Retrieval

↓

Planning

↓

Personality

↓

Emotion

↓

Tool Selection

↓

Reasoning Model

↓

Response

↓

Memory Update

↓

Reflection Queue
```

---

# Why the LLM is not the Core

The language model is a reasoning component.

It should never own:

- memories
- personality
- goals
- relationships
- planning

This allows Companion AI to remain consistent even when switching from one model provider to another.

---

# Platform Independence

Companion Core should support:

- Unity
- Android
- iOS
- Desktop
- Web
- Quest
- AR Glasses
- Robotics

without changing its architecture.

---

# Responsibilities

Companion Core owns:

✅ Memory

✅ Planning

✅ Personality

✅ Reflection

✅ Relationships

✅ Decisions

✅ Context

✅ Goals

Companion Core does NOT own:

❌ Rendering

❌ Animation

❌ AR Tracking

❌ Voice Playback

❌ Camera Rendering

Those belong to the client application.

---

# Success Criteria

Companion Core is successful if:

- replacing Unity requires no AI changes
- replacing the LLM requires no personality changes
- memories remain consistent across years
- new tools can be added without redesigning the system
- every subsystem has a clear responsibility
- no subsystem depends on Unity-specific code

---

# Implementation Architecture

> Added 2026-07-30, after the `@nexa/core` architecture review. Everything above
> describes *what* Core is responsible for. This section describes *how* the
> orchestration layer is built, and is the normative reference for `@nexa/core`.

Core is the orchestration layer. It owns no engine â€” not the model, not memory,
not planning, not personality. It coordinates them through interfaces it
declares itself, and it is **a deterministic skeleton with exactly two
non-deterministic holes in it**: I/O, concentrated in context assembly, and
language, concentrated in generation.

## The pipeline

```
  ingress â”€â”€â”€ TurnRequest (deadline, capabilities, idempotency key, sink)
     â”‚
     â”œâ”€ [0] ADMISSION        gate per companion Â· dedupe retries Â· reject expired
     â”‚
     â”œâ”€ [1] PERCEPTION       text â†’ Perception                     cheap, local
     â”‚
     â”œâ”€ [2] ASSEMBLY  â•â• the only I/O stage â•â•        contributors, in waves
     â”‚        wave 0: identity* Â· personality* Â· goals Â· workingMemory
     â”‚                tools Â· world Â· emotion Â· relationship Â· plan
     â”‚        wave 1: retrievedMemories (depends on goals)
     â”‚        wave 2: decisionHint (depends on everything it reads)
     â”‚        â†’ budget applied, omissions recorded    (* fatal, rest degrade)
     â”‚
     â”œâ”€ [3] DELIBERATION     deliberate(context) â†’ DecisionDraft         PURE
     â”‚
     â”œâ”€ [4] PLAN REVISION    only when the decision demands it    CONDITIONAL
     â”‚
     â”œâ”€ [5] GENERATION â•â• bounded tool loop â•â•
     â”‚        model â†’ tool_use? â†’ execute â†’ feed back â†’ model
     â”‚        bounded by iterations, deadline and cumulative tokens
     â”‚
     â”œâ”€ [6] VALIDATION       schema check Â· client-capability filter Â· drops recorded
     â”‚
     â”œâ”€ [7] COMMIT           working memory append   (the turn's only mutation)
     â”‚
     â””â”€ [8] PUBLISH          events fan out Â· TurnRecord emitted Â· response
```

Stage 4 is conditional by design. Multi-step goal decomposition on the path of
"how was your day?" is latency spent on almost every turn to serve almost none,
so planning runs in the worker on `nexa.turn.completed` and the turn reads
whatever the last pass produced. The plan may be one turn stale; that is the
trade, and `PlanSnapshot.revisedAt` lets a consumer tell.

## The three Turn objects

The brief for this work listed roughly fifteen fields for "the Turn". They
belong to **three** objects, and conflating them breaks purity.

| Object | Holds | Read by |
|---|---|---|
| `TurnRequest` | what the caller supplies â€” ids, text, deadline, client capabilities, idempotency key, sink | the pipeline |
| `CognitiveContext` | **only what may legitimately change the decision** | `deliberate()` |
| `TurnRecord` | everything *measured about* the turn â€” stage timings, port outcomes, model calls, diagnostics | nothing that reasons |

The separation is load-bearing. If token counts or cost were reachable from
`CognitiveContext`, they would be inputs to `deliberate()`, and the same context
would stop producing the same decision across environments where those
measurements differ.

## Port tiers

See **ADR-006**. Ports are grouped by relationship to the latency path, not by
owning engine, so timeout, failure and degradation policy fall out of the tier
instead of being re-decided per port.

Voice and vision are deliberately **not** Core ports â€” speech recognition
produces the request, synthesis renders the response, and vision writes the world
model asynchronously. A port for either would make Core aware of the client's
output modality, which is the coupling `Nexa.AR` prevents on the Unity side.

## Shared cognitive state

`CognitiveContext` **is** the shared cognitive state every engine contributes
into. There is no separate `Blackboard` abstraction, and there will not be â€”
see **ADR-007** for the full evaluation. In short: it has the shared-state
property but deliberately lacks write-back and opportunistic control, and both
omissions protect determinism, replay and bounded latency.

Contribution *ordering* is a declared dependency graph, validated at
construction. A cycle or a missing dependency is a named boot failure rather
than a turn that silently reads nothing.

## Degradation

The rule everywhere is **degrade, never fail**. Three distinctions make that
signal useful rather than noise:

- **Absent capability is not degradation.** A port that is not composed in
  contributes nothing and records nothing. A companion with no world model has
  no such faculty; it is not a degraded companion.
- **Empty is not degradation.** `isDegraded` excludes `empty` omissions. A
  companion with no active goals had nothing to lose. Counting those pins the
  ratio at ~100% and the metric tracks nothing.
- **Lost is degradation.** `port_timeout`, `port_error`, `budget_exceeded` and
  `not_attempted` all mean something existed and did not arrive.

The model is *told* when context was lost, so it can say so rather than
confabulate over the gap.

## Error handling

| Class | Example | Policy |
|---|---|---|
| Degradable | world times out | omission recorded, turn continues |
| Recoverable | provider 429 | adapter retries within the deadline, then falls back |
| Turn-fatal | identity unavailable, generation exhausted | `Result.err(TurnFailure)` + `nexa.turn.failed` |
| Session-fatal | protocol violation | close the session, keep the process |
| Process-fatal | bad config, missing required port | refuse to boot |

Deadlines and cancellation: **ADR-008**. Retries live in adapters, never in
Core â€” Core owns the deadline, the adapter decides how to spend it.

## Plugin system

`CapabilityModule` descriptors, registered **explicitly**. No filesystem
scanning, no dynamic import: those would buy discovery at the cost of the
property both halves of this codebase enforce â€” the composition root is the
single place a concrete implementation is named.

A module declares `provides`, `requires`, `subscribes` and a config parser.
`bootCapabilities` topologically sorts, initialises, then starts everything once
every port exists, and rolls back what it started if one fails. Because a
capability's whole surface is a `PortMap` plus event subscriptions, an
out-of-process capability is one whose ports are RPC clients â€” no Core change.

## Dependency injection

No container. Constructor injection with explicit dependency objects. A DI
container buys lazy resolution and lifetime management; with roughly fifteen
ports and one composition root, that costs a second dependency graph the
compiler cannot see, in exchange for saving fifty lines of wiring. Revisit past
~40 registrations.

Three lifetimes, and only three: **singleton** (clock, bus, ports â€” must be
stateless with respect to any turn), **session** (voice session, stream
connection), and **turn** (`TurnRecordBuilder`, `AbortController`, deadline â€”
created in `run()`, never injected).

## Observability

Interfaces Core owns â€” `Metrics`, `Tracer`, `Logger` â€” adapted at the
composition root. No vendor SDK reaches `@nexa/core`.

Metrics are derived from the `TurnRecord` rather than emitted from a dozen points
in the pipeline, so a new stage becomes visible the moment it is timed. Labels
stay low-cardinality: never a user id, never a companion id, never a message.

**`nexa_turn_degraded_total` is the headline SLI**, not error rate. A system
designed to degrade shows ~0% errors while quietly getting worse.

**Replay** is the strongest property here. Because `deliberate()` is pure and
`CognitiveContext` is serialisable, a stored context replays exactly: regression
gates on decision drift, step-through debugging of a past decision, and
threshold tuning measured against real traffic before shipping. Contexts are
10â€“30k tokens, so the sampling policy is: always store failures, degraded turns,
low-confidence decisions and multi-round tool loops; 1% of everything else.

