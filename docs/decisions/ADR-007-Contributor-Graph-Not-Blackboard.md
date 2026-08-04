# ADR-007 — `CognitiveContext` Is The Shared Cognitive State; No Blackboard Abstraction

> Status: Accepted
> Date: 2026-07-30
> Affects: `@nexa/core`, `@nexa/models`

## Context

Nexa's design goal is that every engine contributes structured knowledge into
one shared reasoning state rather than engines reasoning about each other:

```
Memory ─┐
World  ─┤
Goals  ─┼──→ shared cognitive state ──→ decision
Emotion─┤
Relat. ─┤
Plan   ─┘
```

The question was whether that calls for an explicit `Blackboard` abstraction,
as future engines (Vision, Robotics, Calendar, Health, Learning, Finance,
autonomous behaviour) arrive.

## Decision

**`CognitiveContext` already is that shared state. No `Blackboard` abstraction
is introduced.**

A classical blackboard (Hearsay-II, HASP) has three defining properties, and the
diagram above needs only the first:

| Property | Blackboard | `CognitiveContext` |
|---|---|---|
| ① shared structured state engines contribute into | yes | **yes** |
| ② write-back — sources mutate it during reasoning | yes | no, immutable |
| ③ opportunistic control — sources re-triggered on change, iterating to quiescence | yes | no, single pass |

`CognitiveContext` is a blackboard's *data structure* without its *control
regime*. Properties ② and ③ are not merely unnecessary; adopting them would
destroy four things already paid for:

- **Write-back breaks purity.** `deliberate(context)` is a function. If engines
  write during reasoning, the decision becomes a function of the *sequence of
  writes*, and offline replay would have to reproduce the interleaving — which
  means reproducing the scheduler, which means reproducing timing.
- **Opportunistic control makes the turn non-deterministic and unbounded.** Two
  runs with identical inputs could differ by which source won a race, and
  "iterate to quiescence" has no upper bound on a path a user is waiting on.
- **Budgeting needs a final contribution set.** `ContextBudget` allocates across
  sections and records why each omission happened. A blackboard where sources
  keep contributing has no moment at which the set is final.
- **Causality becomes forensic.** "It asked a clarifying question because intent
  confidence was 0.31 and the world section timed out" becomes "…and whether
  Emotion had contributed yet depends on scheduling."

### Nexa already has shared state at two timescales

A blackboard would be a redundant third.

| Structure | Timescale | Mutability | Written by | Read by |
|---|---|---|---|---|
| **World model** | continuous, cross-turn | mutable | vision, sensors | the turn, as a snapshot |
| **`CognitiveContext`** | one turn | immutable | assembly, one pass | `deliberate()` |
| **Event log** | permanent | append-only | everything | reflection, replay |

The world model *is* blackboard-shaped — long-lived, mutable, written
opportunistically by independent sources. Separating it from the decision-time
snapshot is what stops reasoning running over a substrate that changes beneath
it. Opportunistic control belongs **upstream** of the turn, where an autonomy
monitor observes events and emits a `TurnRequest` with `source: 'autonomous'`.

## What the question did expose

Contribution *ordering* was hardcoded. `ContextAssembler` fetched goals alone and
then everything else in one parallel block, because retrieval consumes goals —
an edge encoded in the order of two statements. Correct at one edge; a place bugs
hide at six, where a contributor added to the wrong phase silently reads an empty
dependency and nothing fails.

**Fixed with a declared dependency graph, not a blackboard.** Contributors
declare `dependsOn`; the assembler topologically sorts them into waves at
construction and runs each wave in parallel.

This preserves everything: single pass, bounded latency, immutable output, pure
deliberation, working budget. What it adds:

- adding Calendar / Health / Finance is **declaring a contributor**, not editing
  a scheduler;
- the graph is inspectable and validated at boot — a cycle or missing dependency
  is a named boot failure, not a turn that reads nothing;
- a dependent is told *why* a dependency is missing (`view.outcomeOf(GOALS)`),
  because "no goals exist" and "the goal service timed out" call for different
  behaviour and an empty array cannot distinguish them;
- a side benefit: goals now runs parallel to identity and personality, so
  assembly latency fell from `goals + max(rest)` to `max(wave 0) + retrieval`.

## Consequences

**Good.** The extensibility the blackboard was reached for, at roughly one
class, with determinism and replay intact.

**Costs.** Contributors can only read what they declare, so a hidden edge that
worked by accident of ordering now returns `undefined`. That is the intended
trade — an undeclared edge is one that breaks the day an unrelated contributor
is added — but it will surprise someone once.

**Open.** If a future engine genuinely needs iterative refinement, it belongs
inside a single contributor that loops internally under its own budget, not in
the assembly scheduler.
