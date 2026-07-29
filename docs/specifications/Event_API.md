# Event API

> Version: 1.0
> Status: Accepted
> Package: `@nexa/events`

---

# Purpose

The normative specification of the event envelope, the bus interface, and the
event catalogue. `architecture/06_Event_System.md` explains the reasoning; this
document is the contract.

---

# Envelope

Every event on the bus has this shape. Payloads vary; the envelope never does.

```ts
interface EventEnvelope<TType extends string, TPayload> {
  /** UUID v7. Time-ordered, and the idempotency key for every handler. */
  readonly id: EventId;

  /** Namespaced type, e.g. "nexa.memory.stored". */
  readonly type: TType;

  /** Schema version of the payload. Starts at 1, increments additively. */
  readonly version: number;

  /** Emission time, ISO 8601 UTC. Set by the bus, never by the caller. */
  readonly occurredAt: string;

  /** Companion this fact concerns. The partition key — ordering is per-companion. */
  readonly companionId: CompanionId;

  /** Owning user. Present on every event so deletion can be enforced by user. */
  readonly userId: UserId;

  /** Correlation: the turn that produced this event, when there was one. */
  readonly turnId: TurnId | null;

  /** Causation: the event that caused this one. Null when user-initiated. */
  readonly causedBy: EventId | null;

  /** The facts. Immutable. */
  readonly payload: TPayload;
}
```

## Field rules

**`id`** — UUID v7 so identifiers sort by time, which makes the event log
naturally ordered and range-scannable. Also the idempotency key: handlers
record processed ids and treat a repeat as a no-op.

**`companionId`** — the partition key. All events for one companion are ordered
relative to each other; nothing is ordered globally. Never optional.

**`userId`** — present on every event, including those triggered by autonomous
behaviour, so "delete everything about me" is a single indexed predicate rather
than a graph traversal.

**`turnId` / `causedBy`** — the causality chain. `turnId` groups everything one
user message produced; `causedBy` links an event to its direct cause. Together
they let any outcome be traced back to its origin, which is what
`10_Decision_Engine.md` requires for explainability.

**`payload`** — carries identifiers and the facts that changed, never whole
aggregates. A consumer that needs the full object loads it through a port.

---

# Bus interface

```ts
interface EventBus {
  publish<E extends DomainEvent>(event: E): Promise<void>;
  publishAll(events: readonly DomainEvent[]): Promise<void>;
  subscribe<T extends DomainEventType>(
    type: T,
    handler: EventHandler<EventOfType<T>>,
  ): Unsubscribe;
}

type EventHandler<E> = (event: E) => Promise<void>;
type Unsubscribe = () => void;
```

## Contract

- `publish` resolves once the event is **accepted for delivery**, not once
  handlers have run. Callers never await handlers.
- `publishAll` is atomic: all events are accepted or none are.
- A handler that throws is logged and retried per policy. It never propagates
  to the publisher and never blocks other handlers.
- Handlers for the same event run concurrently. Do not rely on ordering between
  them.
- `subscribe` returns an unsubscribe function. Composition roots use it to shut
  down cleanly.

## Publishing helper

Callers do not construct envelopes. They describe the fact and the bus fills in
identity, time and correlation from ambient turn context:

```ts
bus.publish(
  memoryStored({
    memoryId,
    memoryType: 'episodic',
    importance: 0.82,
  }),
);
```

This removes the two most common event bugs — a hand-written timestamp, and a
missing `causedBy` — by construction rather than by review.

---

# Catalogue

`✓` = implemented in Milestone 1.

## Turn lifecycle

| Type | v | Payload | |
|---|---|---|---|
| `nexa.turn.started` | 1 | `{ source: 'user' \| 'autonomous', intent: string \| null }` | ✓ |
| `nexa.turn.completed` | 1 | `{ actionCount: number, durationMs: number, degraded: boolean }` | ✓ |
| `nexa.turn.failed` | 1 | `{ stage: TurnStage, reason: string }` | ✓ |

`degraded` is true when any context section was dropped or a port timed out. It
is the signal that a thin answer had a cause.

## Decision and action

| Type | v | Payload | |
|---|---|---|---|
| `nexa.decision.made` | 1 | `{ decisionId, kind: DecisionKind, confidence: number, reasonCodes: string[], alternatives: DecisionKind[] }` | ✓ |
| `nexa.action.generated` | 1 | `{ actionId, actionType: ActionType, decisionId }` | ✓ |
| `nexa.action.executed` | 1 | `{ actionId, actionType, success: boolean, clientId: string }` | |
| `nexa.action.rejected` | 1 | `{ actionType, reason: 'schema' \| 'safety' \| 'permission' \| 'budget' }` | |

`reasonCodes` are stable enumerated strings, not prose. Prose cannot be
aggregated, and "why did it ask that?" is a question worth answering with
statistics as well as narrative.

## Memory

| Type | v | Payload | |
|---|---|---|---|
| `nexa.memory.candidate.created` | 1 | `{ candidateId, sourceType, rawContent: string }` | ✓ |
| `nexa.memory.stored` | 1 | `{ memoryId, memoryType: MemoryType, importance: number }` | |
| `nexa.memory.retrieved` | 1 | `{ memoryIds: MemoryId[], scores: number[], queryKind: string }` | |
| `nexa.memory.consolidated` | 1 | `{ resultId, mergedIds: MemoryId[] }` | |
| `nexa.memory.forgotten` | 1 | `{ memoryId, reason: 'decay' \| 'duplicate' \| 'user_request' }` | |

`nexa.memory.forgotten` is emitted for user-requested deletion too, so the
audit trail records the deletion even after the memory is gone.

## Cognition

| Type | v | Payload | |
|---|---|---|---|
| `nexa.emotion.changed` | 1 | `{ previous: EmotionSnapshot, current: EmotionSnapshot, trigger: string }` | |
| `nexa.reflection.finished` | 1 | `{ reflectionId, insightIds: MemoryId[], window: { from, to } }` | |
| `nexa.relationship.updated` | 1 | `{ dimension: 'trust' \| 'familiarity', previous: number, current: number }` | |
| `nexa.personality.evolved` | 1 | `{ trait: string, previous: number, current: number, cause: string }` | |

## Goals and planning

| Type | v | Payload | |
|---|---|---|---|
| `nexa.goal.created` | 1 | `{ goalId, title: string, priority: Priority }` | |
| `nexa.goal.completed` | 1 | `{ goalId, durationDays: number }` | |
| `nexa.goal.abandoned` | 1 | `{ goalId, reason: string }` | |
| `nexa.plan.created` | 1 | `{ planId, goalId, taskCount: number }` | |
| `nexa.plan.revised` | 1 | `{ planId, added: number, removed: number, reason: string }` | |

## Tools and world

| Type | v | Payload | |
|---|---|---|---|
| `nexa.tool.executed` | 1 | `{ toolId, success: boolean, durationMs: number }` | |
| `nexa.world.updated` | 1 | `{ aspect: 'location' \| 'device' \| 'environment', summary: string }` | |
| `nexa.voice.finished` | 1 | `{ utteranceId, durationMs: number }` | |

---

# Type safety

The catalogue is a discriminated union, so `subscribe` narrows the payload from
the type string alone:

```ts
type DomainEvent =
  | TurnStartedEvent
  | TurnCompletedEvent
  | DecisionMadeEvent
  // ...

bus.subscribe('nexa.decision.made', async (event) => {
  event.payload.confidence; // number — inferred, not asserted
});
```

Handlers never cast. If a cast is needed, the catalogue is wrong.

---

# Versioning rules

Restating the binding constraint from `06_Event_System.md`:

- **additive only** — new fields must be optional; existing fields are never
  removed, renamed, or retyped
- a breaking change is a **new type** (`nexa.memory.stored.v2`), with both
  emitted during migration
- consumers **ignore** unknown fields rather than rejecting them
- `version` increments on every additive change

The event log is replayed by reflection, analytics, and debugging. A log that
cannot be read by current code is not a log.

---

# Milestone 1 scope

Shipped: envelope, bus interface, `InProcessEventBus`, publishing helpers, and
the six `✓` events above.

Not shipped: Redis transport, PostgreSQL event log, dead-letter handling,
replay tooling. Each arrives without handler changes, because the interface is
already the boundary.

---

# References

architecture/06_Event_System.md
architecture/05_Data_Flow.md
architecture/04_System_Architecture.md
