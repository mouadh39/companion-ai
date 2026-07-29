# System Architecture

> Version: 1.0
> Status: Accepted
> Applies to: Milestone 1 onward

---

# Purpose

This document defines how Nexa is physically organised: what the packages are,
which package may import which, and how the whole thing is deployed.

`03_Companion_Core.md` describes what the Companion *is*. This document
describes how that is arranged as code a team can work on for years without it
collapsing into a ball of mud.

---

# Two decisions that shape everything else

## Decision 1 — Modular monolith, not microservices

Nexa deploys as **one API process and one worker process**, both built from the
same package graph.

The temptation is to start with `memory-service`, `ai-service`, `voice-service`
and `world-service` as separate deployables, because that is what the system
will *look like* at scale. That would be a mistake today, and the reason is
specific rather than ideological.

A single cognitive turn touches memory, the model provider, and the world
model. If those live in three processes, every user message pays three or more
network round trips **before any thinking happens** — on a path already
spending one to three seconds inside a language model. On top of that you
inherit distributed tracing, partial-failure semantics, and cross-process
schema versioning, all designed against access patterns nobody has measured.

Microservices solve organisational and scaling problems that Nexa does not have
yet. They do not solve modularity. **Modularity comes from enforced package
boundaries, and those are nearly free.**

What this buys: extracting `memory-service` later becomes a packaging change
rather than a rewrite, because the boundary already exists and is enforced. The
option is preserved without paying for it now.

**Trigger conditions for extracting a service.** Split when at least one holds,
and not before:

- the module must scale independently on a different resource axis
- the module needs an independent failure domain
- the module needs a different runtime or hardware (GPU inference)
- one team's release cadence is genuinely blocked by another's

## Decision 2 — Dependency inversion at the Core boundary

`@nexa/core` owns the domain and **declares the ports**. Capability packages
**implement** those ports. The composition root wires them together.

This means `@nexa/core` never imports `@nexa/memory`. The orchestrator depends
on an interface it owns; the memory implementation depends on that same
interface. Both point inward.

The alternative — Core importing every capability directly — makes Core a hub
that must change whenever any capability changes, and impossible to test
without instantiating the entire system. It is also how "everything
communicates through events" gets adopted as a workaround for a dependency
problem that an interface should have solved.

---

# Package graph

```
                          apps/backend            apps/worker
                        (composition root)   (composition root)
                                 │                    │
        ┌────────────────────────┴──────┬─────────────┘
        │                               │
        ▼                               ▼
  capability packages            @nexa/core
  ┌──────────────────┐          ┌──────────────────┐
  │ memory           │          │ domain model     │
  │ personality      │─────────▶│ PORTS            │
  │ emotion          │ implement│ CognitiveTurn    │
  │ goals            │          │ Deliberator      │
  │ relationship     │          └──────────────────┘
  │ world            │                    │
  │ planning         │                    │
  │ conversation     │                    ▼
  │ tools            │             @nexa/events
  │ actions          │                    │
  │ providers        │                    ▼
  └──────────────────┘             @nexa/models
        │                                 │
        └────────────────┬────────────────┘
                         ▼
                    @nexa/shared
```

Arrows point in the direction of *allowed imports*.

## Layer rules

| Layer | Packages | May import |
|---|---|---|
| 0 | `@nexa/shared` | nothing internal |
| 1 | `@nexa/models` | `shared` |
| 2 | `@nexa/events` | `shared`, `models` |
| 3 | `@nexa/core` | `shared`, `models`, `events` |
| 4 | capability packages | `shared`, `models`, `events`, `core` |
| 5 | `apps/*`, `services/*` | everything |

Three rules follow, and they are the ones that matter:

1. **No capability package may import another capability package.** Memory does
   not import personality. If a capability needs something from another, it
   receives it through a port declared in Core, injected at composition.
2. **Core may not import any capability package.** Ever. If Core needs
   behaviour, it declares a port.
3. **Only `apps/*` may name concrete implementations.** This mirrors the rule
   already enforced in the Unity client, where `Nexa.App` is the sole assembly
   naming concrete AR types.

These are not conventions. They are enforced — see *Enforcement*.

## Package responsibilities

| Package | Owns |
|---|---|
| `@nexa/shared` | Pure primitives with no domain knowledge: `Result`, branded IDs, `Clock`, typed error base, guards. No dependencies, ever. |
| `@nexa/models` | Domain types and their invariants: `Memory`, `Decision`, `Action`, `Goal`, `EmotionState`, `PersonalityProfile`. Data and validation only — no I/O. |
| `@nexa/events` | The event envelope, the typed bus interface, and an in-process implementation. |
| `@nexa/core` | Ports, the `CognitiveTurn` orchestrator, the `ContextAssembler`, the pure `Deliberator`, and the context budget. The intelligence's *shape*. |
| `@nexa/memory` | Working, episodic, semantic, procedural and relationship memory; retrieval scoring; consolidation. |
| `@nexa/providers` | Model provider adapters behind one interface. |
| `@nexa/actions` | Action definitions and validation. The vocabulary clients execute. |
| `@nexa/personality`, `@nexa/emotion`, `@nexa/goals`, `@nexa/relationship`, `@nexa/world`, `@nexa/planning`, `@nexa/conversation`, `@nexa/tools` | One cognitive concern each, per their own design documents. |

`packages/utils` was removed. A package whose contract is "useful things" has no
ownership rule, so it accretes unrelated code and quietly becomes a coupling
point between modules that should not know about each other. Pure helpers live
in `@nexa/shared` under a stated contract: **dependency-free, domain-free, and
individually justified.**

---

# Deployment topology

```
                    ┌──────────────┐
   clients ────────▶│ apps/backend │  Fastify. Request/response.
   (Unity, Flutter, │              │  Owns the synchronous cognitive turn.
    web, desktop)   └──────┬───────┘
                           │ emits events
                           ▼
                    ┌──────────────┐
                    │    Redis     │  Event transport + cache + queue
                    └──────┬───────┘
                           │ consumes events
                           ▼
                    ┌──────────────┐
                    │ apps/worker  │  Reflection, consolidation, embedding,
                    │              │  scheduled autonomy. No client traffic.
                    └──────┬───────┘
                           │
        ┌──────────────────┼──────────────────┐
        ▼                  ▼                  ▼
  ┌───────────┐     ┌───────────┐     ┌───────────┐
  │ PostgreSQL│     │  Qdrant   │     │ Providers │
  │  system   │     │  vectors  │     │ (LLM APIs)│
  │ of record │     │           │     │           │
  └───────────┘     └───────────┘     └───────────┘
```

**Why the worker is separate from day one.** It is the one split justified now,
and justified on *failure domain* rather than scale. Reflection and
consolidation are long-running, bursty, and involve many model calls. Running
them in the API process means a reflection storm degrades live conversation
latency. They also have opposite retry semantics: a failed turn must surface to
the user immediately; a failed consolidation should back off and retry later.

It is not a microservice. It shares the entire package graph and is built from
the same repository. It is a **second entry point over the same code**, which
costs almost nothing and isolates the noisy work.

---

# Data ownership

| Store | Holds | Why |
|---|---|---|
| PostgreSQL | System of record: memories, goals, plans, relationships, personality, decision log, event log. | Relational integrity and transactional writes. Everything else is rebuildable from here. |
| Qdrant | Embeddings and vector search only. | A vector index is a derived structure, never a source of truth. |
| Redis | Event transport, working memory, session cache, job queue. | Everything here is ephemeral or reconstructible. Losing Redis costs the current turn's context, not the user's history. |

**Rule: Qdrant and Redis hold nothing that cannot be rebuilt from PostgreSQL.**
This is what makes "memory belongs to the user" and the export/delete
requirement tractable — there is exactly one place to look.

---

# Enforcement

Boundaries that are documented but not enforced decay within weeks. The layer
rules are enforced mechanically:

- **TypeScript project references** — a package cannot import from one it does
  not reference; the compiler refuses.
- **`eslint-plugin-import` `no-restricted-paths`** — encodes the layer table
  directly, so a violation fails lint with a message naming the rule.
- **`package.json` `exports`** — each package exposes a single public entry
  point. Deep imports into another package's internals are unreachable.
- **CI** — the boundary check runs on every pull request and blocks merge.

Any change to the layer table is an ADR, not a pull-request comment.

---

# Testing strategy

The architecture is arranged so that the valuable tests are the cheap ones.

| Layer | Test style | Requires |
|---|---|---|
| `Deliberator` | Pure unit + snapshot. Same context in, same decision out. | nothing |
| `ContextAssembler` | Unit with fake ports. | nothing |
| Capability packages | Unit against port contracts. | nothing |
| Port contracts | One shared contract suite run against every implementation, real and fake. | containers for real ones |
| `CognitiveTurn` | Integration with in-memory adapters. | nothing |
| `apps/backend` | End-to-end against the real graph. | docker compose |

The `Deliberator` being a pure function is the highest-leverage decision here.
It makes reasoning snapshot-testable and lets any production decision be
replayed offline from its logged context — which turns "decisions should be
explainable" from an aspiration into a mechanism.

---

# Relationship to the Unity client

The Unity project at `Unity/Nexa/` is a **client**, exactly as ADR-001 states.
It has its own architecture document under `docs/unity/`.

The constraint relevant here: Unity receives `Action` objects and nothing else.
It never receives free text to interpret, and never asks the backend a question
about cognition. The action vocabulary in `@nexa/actions` is the entire
contract between them.

`apps/unity-client/` in this repository is a placeholder for client-side
TypeScript tooling. The Unity project itself deliberately stays outside the
pnpm workspace — a Unity project inside a workspace glob causes package
managers to walk `Library/`, which is tens of thousands of generated files.

---

# What Milestone 1 builds

Milestone 1 is a **vertical slice**, not a horizontal layer: a message enters
and an `Action[]` leaves, every seam real, the implementations behind them
shallow.

Created: `@nexa/shared`, `@nexa/models`, `@nexa/events`, `@nexa/core`,
`@nexa/providers` with one adapter, `@nexa/actions`, and `apps/backend` with a
single endpoint.

Deferred: PostgreSQL, Qdrant, Redis, the worker, and every capability package
beyond an in-memory working memory.

The reason for slicing vertically is that interfaces designed against imagined
callers are wrong in ways that only surface when a real caller arrives. The
slice makes the callers real while changing an interface still costs nothing.

---

# References

03_Companion_Core.md
05_Data_Flow.md
06_Event_System.md
ADR-001-Unity-Is-A-Client.md
ADR-002-LLM-Is-Replaceable.md
