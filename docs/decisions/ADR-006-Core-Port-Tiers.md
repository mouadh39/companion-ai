# ADR-006 — Ports Are Tiered By Latency Path, Not By Owning Engine

> Status: Accepted
> Date: 2026-07-30
> Supersedes: nothing
> Affects: `@nexa/core`

## Context

Core coordinates ten-plus engines through interfaces it declares. The obvious
grouping is by owning engine — a `MemoryPort`, a `PlanningPort`, a `VoicePort`,
one per subsystem. That grouping was proposed and rejected.

Grouping by engine says nothing about the three questions that actually have to
be answered for every port:

1. How long may it take?
2. What happens when it fails?
3. May the turn proceed without it?

Answered per port, those get re-derived a dozen times and drift apart. The first
memory port to be written establishes an accidental convention; the fifth one
disagrees with it and nobody notices until a production incident degrades
differently than expected.

## Decision

Ports are grouped by their **relationship to the turn's latency path**.

| Tier | Members | Timeout | Failure | Side effects |
|---|---|---|---|---|
| **0 · ingress** | STT, vision, transport, scheduler | n/a — outside the turn | n/a | n/a |
| **1 · context** | Identity\*, Personality\*, WorkingMemory, MemoryRetrieval, Goals, Tools, World, Emotion, Relationship, PlanRead, DecisionAdvisor | per-contributor, subdivided from the assembly deadline | degrade, record an omission | **forbidden** |
| **2 · generation** | LanguageModel, ToolExecution, TokenEstimator | remaining deadline less the commit reserve | recoverable, then turn-fatal | expected |
| **3 · egress** | MemoryWrite | after the answer exists | can never fail a turn | expected |

`*` — identity and personality are the only fatal context ports. Without them
the companion is not itself; everything else is optional by construction.

Three properties then fall out of the tier rather than being decided per port:

- **Tier 1 is parallel and degradable by construction.** A port whose absence
  the answer can survive belongs in Tier 1. One whose absence it cannot survive
  is not a Tier 1 port, it is a precondition.
- **Tier 1 must be side-effect free.** These run under a race that can abandon a
  slow result, so a Tier 1 port that writes is one that writes
  non-deterministically.
- **Tier 3 never returns a value the turn uses**, so it can be made
  asynchronous, batched, or moved out of process without touching Core.

### Voice and vision are not Core ports

They sit on the other side of the turn boundary:

- **Voice in** (STT) runs *before* the turn exists; it produces the text that
  becomes a `TurnRequest`.
- **Voice out** (TTS) runs *after* the turn returns; it renders a `SpeakAction`.
- **Vision** produces observations at 30–60 Hz and cannot be a turn-scoped call.
  It writes the world model asynchronously; the turn reads a `WorldSnapshot`.

If Core called `voice.synthesize()`, Core would own the output modality — it
would be deciding that this client has speakers. That is precisely the coupling
`Nexa.AR` prevents on the Unity side, where `Nexa.Character` physically cannot
reference AR Foundation. The same rule, one layer down.

### Reflection has no port at all

Reflection is a consumer of turns, not a participant in them. It subscribes to
`nexa.turn.completed`. A `ReflectionPort` would mean Core knew one of its
downstream consumers by name, which is the hub coupling this design exists to
prevent. The same argument retires the *write* half of Emotion and Relationship:
Core publishes, the engines listen.

## Consequences

**Good.** Timeout, failure and degradation policy are properties of the tier, so
a new port inherits them instead of inventing them. Adding a capability is
declaring a contributor. The client's output modality never reaches Core, which
is what keeps the AR-glasses and robotics ports cheap.

**Costs.** Some engines are split across two ports — `ToolRegistryPort` versus
`ToolExecutionPort`, `PlanReadPort` versus `PlanRevisionPort` — which looks like
duplication until you notice the read path is called on every turn and the write
path is not. That split is the point, not an accident of the taxonomy.

**Open.** A capability that genuinely needs to both read during assembly and
write during commit has to expose two ports. No such capability exists yet.

## Alternatives considered

- **One port per engine.** Rejected: re-derives the three policy questions per
  port, and puts vision and voice inside the turn where neither belongs.
- **One `EnginePort` with a discriminated request.** Rejected: collapses ten
  different failure policies into one switch statement, and makes the compiler
  useless for checking that a capability is wired.
