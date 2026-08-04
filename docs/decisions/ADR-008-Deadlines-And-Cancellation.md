# ADR-008 — One Deadline Per Turn, Subdivided; Cancellation Is Real

> Status: Accepted
> Date: 2026-07-30
> Affects: `@nexa/core`, every port implementation

## Context

Milestone 1 gave `ContextAssembler` a fixed per-port timeout of 150 ms,
implemented by racing a timer against the port's promise.

Two problems, both invisible in normal operation:

1. **A fixed per-port constant composes badly.** Under load, assembly could
   spend 150 ms on every port in turn and still return nothing, and no number
   written into `AssemblerOptions` bears any relationship to how long the caller
   was actually willing to wait.
2. **Racing a timer stops the waiting, not the work.** The abandoned port kept
   its database connection and kept spending provider quota, and its result was
   thrown away. The code even had to swallow the orphaned rejection to stop Node
   killing the process.

## Decision

**One `Deadline` owns the turn. Every stage receives a subdivision of it.**

- A deadline is **absolute**, not a duration, so a port called at the end of
  assembly sees the time genuinely left rather than the time its stage was
  nominally allotted.
- `Deadline.subdivide(ms)` returns `min(parent.expiresAt, now + ms)`. **A child
  can never outlive its parent.** That single invariant is what stops a stage
  borrowing from the stages after it.
- `Deadline.withReserve(ms)` holds time back. Generation is handed the deadline
  less a commit reserve, because producing an answer and then failing to persist
  it is strictly worse than producing a slightly shorter one — the user sees a
  reply the companion has no memory of giving.
- The caller's `deadline` on `TurnRequest` wins when supplied. A client with a
  spinner knows when the answer stops being worth waiting for; a constant
  compiled into the backend does not.

**Every port takes `PortOptions { signal, deadline, turnId }`** and `callPort` is
the only way to invoke one. It never throws: a port failing is expected on a path
required to degrade, so the failure comes back as a value and the caller decides
at the call site whether it costs a thinner answer or the turn.

**Cancellation is a real `AbortSignal`.** On timeout `callPort` aborts the scoped
controller *before* rejecting — aborting stops the work, rejecting only stops
waiting on it. Adapters forward the signal to `fetch`, the driver, or the SDK.
Race-and-abandon survives only as the fallback for adapters that genuinely
cannot be cancelled.

**`not_attempted` is a distinct outcome** from `timeout`. The first indicts
everything that ran before this port; the second indicts the port. Collapsing
them sends you optimising a dependency that was never slow.

## Consequences

**Good.** A cancelled turn stops spending. The turn honours a contract the
caller set. Over-budget turns degrade at the stage that is actually late.
Diagnosis distinguishes "slow port" from "late turn".

**Costs.** Every port signature grew a parameter. This turned out to be free —
TypeScript permits an implementation to declare fewer parameters than the
interface it satisfies, so all existing adapters compiled unchanged and adopt
`PortOptions` only when they have something to do with it.

**Adapters must honour the signal to get the benefit.** A port that ignores it
still degrades correctly; it just keeps burning its own resources. This is a
per-adapter obligation the type system cannot enforce, and belongs in the
per-port contract test suite.

## Alternatives considered

- **Keep fixed per-port timeouts, add an overall assembly cap.** Rejected: two
  numbers that can disagree, and the cap has no way to shorten the per-port
  budget when earlier stages ran long.
- **Cancellation via a custom token type.** Rejected: `AbortSignal` is what
  `fetch`, the Anthropic SDK and the Postgres driver already accept, so a custom
  type would be adapted away at every boundary.
