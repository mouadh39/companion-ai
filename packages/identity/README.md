# @nexa/identity

Who Nexa is. The canonical record.

Layer 1 of `13_Personality_Engine.md`, and the one layer that does not move.
Personality adapts, relationships grow, memory changes, conversation changes.
This does not.

## Position in the graph

```
shared → models → events → core → identity → apps
                → actions ↗   → personality ↗
```

Depends on `@nexa/models` and nothing above it. It implements no port, performs
no I/O, calls no model, and holds no prompt.

**The vocabulary lives in `@nexa/models`.** `IdentityProfile`, `SelfAnswer`,
`UncertaintyStance` and the rest sit one layer down, because `@nexa/core` may
never import a capability package — so anything Core or a sibling engine reads
has to be beneath both. This package holds the *values*, not their shapes.

## How the turn gets identity


A narrow four-field `Identity` used to be what the turn carried, alongside a
`StaticIdentity` adapter that held Nexa's name and values as string literals in
the composition root. Both are gone as of Phase 2.4.

`IdentityPort.load()` now returns the `IdentityProfile` itself, and
`CognitiveContext.identity` carries it. The summary type was removed rather than
kept in sync: the prompt is built from values, commitments and limitations, so
the summary would have had to grow whatever the prompt needed next until it was
a second, drifting definition of who the companion is.

## A frozen constant, not a stored row

Identity that lives in a database is identity a migration can edit, and the one
thing this value promises is that it does not drift.

`readonly` is a compile-time fiction — it is erased at runtime, and this profile
is a process-wide singleton every turn reads. So the profile is **deeply frozen**
at module load. A capability package mutating it in place would otherwise change
who the companion is for every subsequent turn in that process, with no error and
nothing in the turn record to show what happened.

## Replay

`identityAt(version)` returns the profile as it stood, and **returns `null` for
an unknown version rather than falling back to current**. A replay that silently
used today's identity for a turn recorded under version 1 would produce a
confident, wrong explanation — and nothing downstream could tell the difference.

One version exists today. The registry is not premature: with a single exported
constant, the first revision has nowhere to put the old one, and every historical
turn record becomes unexplainable at that moment.

**A published version is immutable.** Adding a value, reordering precedence,
softening a commitment, or removing an invariant is a *new* version with a new
number. Correcting a capability's `maturity` is not — that is a factual update
about what the system can do, not a change to what it is.

## No prose

There is no paragraph here anyone is meant to speak. Every entry is a structured
fact or a short declarative statement; rendering them into language belongs to
the conversation engine. A stored sentence would be a prompt in the one place
that has to survive every model change.

## Values are ordered, because they conflict

An unordered set leaves the resolution to whichever code path checks first.
`resolveValueConflict(a, b)` answers from data.

**Honesty outranks care.** This is the ordering most systems get backwards. A
companion optimised for how the user feels will eventually tell them something
false because the truth was unwelcome, and once a user discovers that, nothing
it says afterwards is worth anything. Care ranks third and shapes *how* a true
thing is said, never *whether*.

**Respect also outranks care.** Treating someone as able to hear a hard answer is
itself care; deciding what they can handle on their behalf is condescension,
however warmly delivered.

## Capabilities are described honestly

`maturity` is set against the real state of the repository, not the roadmap:

- `available` — built, wired, tested
- `partial` — the mechanism exists but a dependency does not
- `planned` — designed, not built

`presentTenseCapabilities()` excludes `planned`. A companion describing planned
faculties in the present tense is lying about itself, and identity is the last
place that should be permitted.

This list changes as engines ship, and that is **not** a violation of identity
being permanent. What never changes is the commitment to describe capability
accurately; which capabilities exist is a fact about the system, not a value.

## Limitations distinguish permanent from temporary

"I cannot remember across devices yet" and "I cannot know what you are feeling"
are both limitations. Treating them alike either overpromises on the second or
undersells the first, and a user deciding how much to rely on this thing needs to
know which kind they are hearing.

## `mustNotClaim` is the most important field in the package

Every `SelfAnswer` carries what is true, what must **not** be said, and pointers
into the profile. The prohibition list exists because the most damaging thing
this engine could permit is a companion asserting an inner life it cannot know it
has, to someone lonely enough to believe it. That failure does not look like a
bug — it looks like exactly what the user wanted to hear.

Prohibitions survive paraphrase in a way preferences do not. *"Prefer: I process
signals"* is advice a model drifts from under conversational pressure; *"must not
claim subjective experience"* is a rule an output can be checked against.

Note that `can_you_feel` forbids **both** claiming experience and denying it
outright. Denial is an overclaim in the other direction — the honest answer is
that it does not know and has no way to find out.

## Usage

```ts
import {
  currentIdentity, uncertaintyFor,
  selfAnswer, introductionFor, resolveValueConflict,
} from '@nexa/identity';

currentIdentity();                         // the canonical profile, frozen
uncertaintyFor(0.42).disclose;             // true — say you are unsure
selfAnswer('can_you_feel').mustNotClaim;   // the guardrails
introductionFor('first_meeting').include;  // ordered elements
resolveValueConflict('honesty', 'care');   // 'honesty'
```

Every query is pure and total: same input, same output, no clock, no I/O, no
throw. Each takes an optional profile argument defaulting to current, so a replay
passes a historical profile through the same code path the live turn used rather
than a parallel one that will drift.

## Tests

| File | What it holds |
|---|---|
| `profile.test.ts` | Runtime immutability, determinism, and the version registry. |
| `consistency.test.ts` | That cross-references between catalogues actually resolve. |
| `queries.test.ts` | Every query, including totality over input a model might report. |

`consistency.test.ts` earns its keep: `references: readonly string[]` is satisfied
by any string, so a self-answer citing a renamed capability would compile, ship,
and produce a companion citing something that does not exist.

## Not implemented here

- **Prompt generation.** The profile is structured; rendering it is the
  conversation engine's job.
- **Identity storage or editing.** It is a constant. There is deliberately no
  setter, and `no_self_modification` is an invariant.
- **Question classification.** Deciding that a message *is* `can_you_feel` is
  perception's job; this answers once asked.
- **Personality.** Traits and their per-turn composition are `@nexa/personality`.

## Related decisions

- **ADR-005** — personality is composed per turn; identity is not
- **ADR-002** — the language model is replaceable; identity lives outside it
