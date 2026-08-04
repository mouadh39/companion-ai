# Event System

> Version: 1.0
> Status: Accepted
> Applies to: Milestone 1 onward

---

# Purpose

Events are how Nexa records that something happened and how unrelated
subsystems react without knowing about each other. This document defines what
qualifies as an event, the guarantees the bus provides, and how transport
evolves without handlers changing.

The concrete envelope and the event catalogue live in
`specifications/Event_API.md`.

---

# What is and is not an event

This is the single most important rule in the document, because getting it
wrong produces a system that is simultaneously slower and harder to debug than
direct calls.

**An event is a statement of fact about something that already happened.**

It is named in the past tense, it is immutable, and **the emitter does not care
who listens or whether anyone does**. If the emitter needs an answer, needs
ordering, or cannot proceed without the listener, it is not an event.

| Use an event | Use a port (direct call) |
|---|---|
| `MemoryStored` | "retrieve memories for this context" |
| `EmotionChanged` | "score this memory's importance" |
| `DecisionMade` | "generate text from this prompt" |
| `GoalCompleted` | "is this action permitted?" |
| `ReflectionFinished` | anything the caller waits on |

The test: **if you need the return value, it is not an event.** Reaching for
correlation IDs to pair a request event with a response event means a
synchronous call is being reimplemented badly — use a port.

`05_Data_Flow.md` states the consequence: the cognitive turn is a synchronous
pipeline that *emits* events; it is not built out of them.

---

# Naming

`<Aggregate><PastTenseVerb>` — `MemoryStored`, `GoalCompleted`,
`ActionExecuted`.

- past tense, always; `MemoryStored`, never `StoreMemory`
- names a fact, not a command or an intention
- no `Request`/`Response` pairs — that is a port
- the aggregate is the thing the fact is about

Type strings are namespaced for transport and filtering:
`nexa.memory.stored`, `nexa.goal.completed`, `nexa.decision.made`.

---

# Delivery guarantees

| Property | Guarantee |
|---|---|
| Delivery | **At-least-once.** A handler may see an event more than once. |
| Ordering | **Per-aggregate only.** No global ordering, ever. |
| Durability | Persisted before acknowledgement once Redis transport is live. |
| Emitter isolation | A handler failure never fails the emitter. |
| Handler isolation | One handler failing never prevents others from running. |

## Idempotency is mandatory

At-least-once delivery means every handler must be safe to run twice. Handlers
key on `event.id` and treat a redelivery as a no-op.

This is not optional discipline. `18_Memory_Architecture.md` already lists
duplicate memories as a known risk, and a non-idempotent memory writer under
at-least-once delivery produces exactly that — intermittently, under load,
weeks after the code was written.

## Why not exactly-once

Exactly-once delivery does not exist across a process boundary. What exists is
at-least-once delivery plus idempotent handlers, which together are
*observationally* exactly-once. Naming it honestly keeps the requirement where
it belongs: in the handler.

---

# The bus interface

The bus is an interface in `@nexa/events`. Nothing outside that package knows
what the transport is.

```
EventBus
├── publish(event)            fire and forget
├── publishAll(events)        atomic batch
└── subscribe(type, handler)  returns an unsubscribe function
```

Handlers are async, receive one typed event, and return nothing. A handler that
throws is logged and retried according to policy; it never propagates to the
emitter.

## Transport evolution

| Stage | Implementation | Used by |
|---|---|---|
| Milestone 1 | `InProcessEventBus` | single process, no infrastructure |
| Milestone 2+ | `RedisStreamEventBus` | API emits, worker consumes |
| If ever needed | Kafka or equivalent | only under measured need |

Handler code is identical across all three. That is the entire point of the
interface, and it is why Milestone 1 can ship with zero infrastructure without
building something that must later be thrown away.

The in-process bus is **not a toy**: it enforces the same async boundary and
the same isolation rules, so a handler that works there works on Redis.

---

# Ordering, honestly

Global ordering is not provided and should not be relied on. Events from
different aggregates may arrive in any order, and handlers must tolerate it.

Per-aggregate ordering *is* provided — all events for one companion arrive in
emission order — because several subsystems genuinely need it. Relationship
trust and emotional decay are both accumulative: applying two updates out of
order yields a different result.

This is achieved by partitioning on `companionId`, which is also what makes
horizontal scaling possible later: partitions distribute across consumers
without any handler changing.

---

# Versioning

Events are persisted and replayed, so an event written today may be read years
from now by newer code. The schema is therefore an API.

- every event carries an explicit `version`
- **additive changes only**: new optional fields, never removed or retyped ones
- a breaking change means a new type (`nexa.memory.stored.v2`), with both
  emitted during migration
- consumers ignore unknown fields rather than rejecting them

The event log is an asset. Reflection, analytics, debugging and future
retraining all read history, and a log you cannot replay because the schema
moved is worth very little.

---

# The event log

All domain events are persisted to PostgreSQL, append-only.

This gives:

- a complete audit trail of what the companion did and why
- replay for debugging: reconstruct any turn exactly
- the substrate reflection consumes
- transparency, so a user can be shown what was recorded about them

It is append-only. Corrections are new events, never edits — a companion whose
history can be silently rewritten cannot be trusted, and
`18_Memory_Architecture.md` makes user trust a success criterion.

Retention is a product decision, not an engineering one. Deletion is a
user-facing capability under "memory belongs to the user", and it removes both
the memory and the events that produced it.

---

# Failure and retry

| Situation | Behaviour |
|---|---|
| Handler throws | Log with event id and handler name. Retry with exponential backoff, capped. |
| Retries exhausted | Move to a dead-letter stream. Alert. Never silently drop. |
| Emitter cannot reach transport | Log and continue. **The turn already succeeded.** |
| Handler is slow | Isolated by timeout. A slow handler must not stall the stream. |

The last row of that table is the reason events do not belong on the critical
path: nothing here is safe to make a user wait on.

---

# Anti-patterns

Explicitly forbidden, because each is an easy mistake with an expensive tail:

- **Event chains as control flow.** A → B → C → D, where D is what you wanted,
  is a distributed call stack with no stack trace. Orchestrate in the turn.
- **Events carrying entire aggregates.** Carry identifiers and the facts that
  changed. Fat events couple the consumer to the producer's schema.
- **Request/response event pairs.** That is a port.
- **Handlers that emit events synchronously in response to their own trigger.**
  Cycles are unbounded; the bus does not detect them.
- **Depending on cross-aggregate ordering.** It is not guaranteed and will
  break under partitioning.

---

# Milestone 1 scope

`@nexa/events` ships with the envelope, the typed bus interface, the
in-process implementation, and the events the vertical slice actually emits:

```
nexa.turn.started
nexa.turn.completed
nexa.decision.made
nexa.action.generated
nexa.memory.candidate.created
```

No Redis, no persistence, no worker. Handlers are registered but shallow.
Adding transport later is a composition-root change in `apps/backend` and
nothing else.

---

# References

04_System_Architecture.md
05_Data_Flow.md
18_Memory_Architecture.md
specifications/Event_API.md
