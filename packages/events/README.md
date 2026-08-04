# @nexa/events

The communication backbone. Every engine learns what happened here.

An event is a **statement of fact about something that already happened**. It is
named in the past tense, it is immutable, and the emitter does not care who
listens or whether anyone does.

## The one rule

> **If you need the return value, it is not an event.**

Use a **port** for anything the caller waits on — "retrieve memories for this
context", "generate text from this prompt", "is this action permitted?". Use an
**event** for anything that is simply true afterwards — `MemoryStored`,
`EmotionChanged`, `GoalCompleted`.

This is why the cognitive turn is a synchronous pipeline that *emits* events
rather than being built out of them. Event chains as control flow are a
distributed call stack with no stack trace; `06_Event_System.md` lists them
first among the anti-patterns. The shape is CQRS: **the turn is a command,
everything downstream is a projection.**

## Layout

```
src/
├── interfaces/  envelope, defineEvent
├── bus/         EventBus, EventPublisher, EventSubscriber,
│                EventHandler, EventMiddleware
├── events/      the catalogue — one directory per domain
├── registry/    runtime lookup of event definitions
├── errors/      typed failures for reporting and dead-lettering
└── utils/       handler decorators and filter builders
```

50 event types across 14 domains. Consumers import from `@nexa/events`, never
from a subpath.

## Publishing

Callers never construct envelopes. They describe the fact; the bus stamps
identity and time.

```ts
await bus.publish(
  memoryStored(correlation, {
    memoryId,
    memoryType: 'episodic',
    importance: importance(0.82),
    source: 'conversation',
  }),
);
```

This removes the two most common event bugs — a hand-written timestamp and a
forgotten `causedBy` — by construction rather than by review.

## Subscribing

```ts
const off = bus.subscribe(
  'nexa.memory.stored',
  oncePerEvent(async (event) => {
    event.payload.importance; // ImportanceScore — inferred, never cast
  }),
  { name: 'memory-indexer', filter: forCompanion(companionId) },
);
```

Handlers never cast. If a cast is needed, the catalogue union is wrong.

## Guarantees, stated honestly

| Property | Guarantee |
|---|---|
| Delivery | **At-least-once.** A handler may see an event more than once. |
| Ordering | **Per-companion only.** No global ordering, ever. |
| Emitter isolation | A handler failure never reaches the publisher. |
| Handler isolation | One handler failing never stops the others. |
| Blocking | `publish` resolves on *acceptance*, never on handler completion. |

**Idempotency is mandatory, not optional discipline.** At-least-once delivery
means every handler must be safe to run twice. Wrap handlers in `oncePerEvent`,
which keys on `event.id`.

### What `once()` does and does not mean

`once()` detaches after one delivery **in this process**. It is not "once per
event in the system" — a redelivery after the handler detached is simply not
seen. Safe for tests and one-shot wiring; wrong for anything whose correctness
depends on having observed the event. For that, use `subscribe` + `oncePerEvent`.

### What priority does and does not mean

Priority orders the **start** of handlers within one process. It is not an
ordering guarantee:

1. Handlers are not awaited, so priority never orders *completion* — pinned by
   a test that asserts exactly this.
2. It cannot survive the Redis transport, where handlers live in separate
   consumer processes.

If two handlers must run in sequence, that is one handler, or a sequenced
pipeline. It is not a bus.

## Durability

`persistent` events go to the append-only log. `ephemeral` ones are delivered
and never written.

The classification exists because perception does not scale like cognition: a
headset emitting object detections at 30–60 Hz produces millions of rows per
user per day on the table reflection and analytics must scan. All five
`nexa.perception.*` events are ephemeral. **A consumer needing perception
history is using the wrong event** — durable environmental knowledge comes from
`nexa.world.*`.

`nexa.perception.face.detected` carries a count and a confidence only — no
biometric data, no identity, no image. Face data in a log designed never to be
edited collides directly with erasure obligations, so the sensitive part never
enters the system rather than being deleted from it later.

## Versioning

Events are persisted and replayed, so the schema is an API.

- every event carries an explicit `version`
- **additive only** — new optional fields, never removed or retyped ones
- a breaking change is a new type (`nexa.memory.stored.v2`), both emitted during
  migration
- consumers ignore unknown fields rather than rejecting them

## Adding an event

Three edits, none of which any existing handler can notice:

1. Add the payload + `defineEvent` call in `events/<domain>/index.ts`
2. Add it to that domain's union and its `*_EVENTS` array
3. If the domain is new, add it to `DomainEvent` and `ALL_EVENT_DEFINITIONS`

## Envelope field mapping

The Milestone 3 brief used different spellings for five fields. The accepted
`Event_API.md` names are authoritative:

| Brief | Envelope |
|---|---|
| `eventId` | `id` |
| `eventType` | `type` |
| `timestamp` | `occurredAt` |
| `correlationId` | `turnId` |
| `causationId` | `causedBy` |
| `source`, `version`, `payload`, `metadata` | same |

Plus `companionId` (the partition key), `userId` (so per-user deletion is one
indexed predicate), and `durability`.

## Tests

```bash
pnpm --filter @nexa/events test
```

49 tests covering publish, subscribe, unsubscribe, once, async handlers,
concurrency, middleware, priority, filtering, error isolation, handler
timeouts, lifecycle hooks, idempotency and the registry.
