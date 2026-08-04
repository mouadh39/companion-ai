# ADR-005 — Personality Is Composed Per Turn, Not Stored And Not Prompted

> Status: Accepted
> Date: 2026-07-31
> Supersedes: nothing
> Affects: `@nexa/personality`, `@nexa/models`

## Context

`13_Personality_Engine.md` requires a companion that feels like the same
individual across conversations, devices, years, and model upgrades — while
still adapting to who it is talking to and how they seem right now.

Those two requirements pull in opposite directions, and there are three obvious
ways to resolve them. Two are wrong.

**Personality as a prompt fragment.** Write the character into the system prompt
and let the model interpret it. This is what most assistants do, and it fails the
first requirement outright: personality then lives inside the thing ADR-002 says
is replaceable, so swapping providers changes who the companion *is*. It is also
unobservable — there is no value to log, no way to answer "why was it curt?", and
no way to test a personality rule without a model call.

**Personality as stored per-turn state.** Persist the adapted behaviour, so the
companion "remembers" how it was last time. This fails the first requirement more
subtly: the stored value drifts toward whatever the companion did most recently,
so one exchange with a stranger leaves it permanently more formal. It also makes
the profile a function of the *sequence* of past turns rather than of the current
inputs, which destroys replay for exactly the same reason write-back does in
ADR-007.

**Personality as disposition plus per-turn composition.** Store only what moves
slowly; derive the rest, every turn, from inputs that are all already recorded.

## Decision

Personality is **three layers**, and only the middle one is persisted.

| Layer | What | Storage | Moves over |
|---|---|---|---|
| 1 · Core identity | Name, values, self-description | `Identity` | Never, without deliberate revision |
| 2 · Traits | Disposition — warmth, curiosity, directness, formality | `PersonalityProfile.traits` | Months |
| 3 · Adaptive behaviour | Tone, detail, initiative, pacing | **Derived, never stored** | Within a turn |

`composeExpression` is a **pure function** producing an `ExpressionProfile` from
four inputs, in ascending order of authority:

```
  base traits  →  relationship  →  conversation context  →  stated preferences
  (disposition)   (earned)         (momentary)              (explicit)
```

Later layers move what earlier ones produced. Only the base layer sets.

### Consequences of purity

The same request always yields the same profile. That gives the same three
properties `deliberate()` has: every rule is testable without stubbing anything,
any profile can be reproduced offline from a logged request, and nothing in the
engine can fail in a way that costs the user their answer.

It also means the engine implements **no port**. Loading the stored
`PersonalityProfile` is `PersonalityPort`'s job and stays in the composition
root, so `@nexa/personality` performs no I/O at all.

### Two rules deliberately break the gradient

Both break it toward restraint, because the failure each prevents is not
recoverable by the next turn.

- **Distress drives humour to zero**, not merely down, whatever the traits and
  relationship say.
- **`allowProactiveSpeech: false` caps initiative** at `offer`. `lead` is
  unreachable from traits alone by construction.

### Stated preferences outrank inferred ones totally

Exactly one communication style is applied, resolved in the layer that can see
both. Applying the inferred style and then the stated one leaves a residue — the
stated preference gets the last word without actually overriding — and a
companion that overrules an explicit setting with its own guess is one the user
cannot configure.

### Where the vocabulary lives

`ExpressionProfile` and its enums live in `@nexa/models`, not in
`@nexa/personality`. `@nexa/core` may never import a capability package, so
anything Core or a sibling engine reads must sit beneath both. This mirrors
`Action`, which lives in `models` while `@nexa/actions` only validates it.

`ExpressionProfile` reuses `SpeechTone` rather than declaring a parallel tone
vocabulary. Two vocabularies would need a mapping layer, and the mapping is where
a tone the client cannot render gets invented.

## Alternatives rejected

**A single `personality` number.** Cannot represent the configurations that
matter: high familiarity with low trust is someone the companion knows well and
should still be careful with, and that is precisely the case where being
presumptuous costs most.

**Hardcoded personas** (`friendly`, `professional`, `playful`). Composable traits
were chosen instead because personas do not blend. A user who wants a
professional companion that is also warm has to be given a fourth persona, and
the set grows combinatorially while every persona duplicates the rules of its
neighbours.

**`energy` as a trait.** It already exists on `AdaptiveState`. Adding it
alongside the traits would give two sources of truth for one quantity, and
whichever layer read the stale one would be wrong in a way nothing detects.

**Scaling emotional adjustments by confidence** rather than gating on a
threshold. Seems gentler; is worse. Every low-confidence guess would still move
the output, so the companion would be permanently, slightly wrong about how
everyone feels. `10_Decision_Engine.md` requires weak signals to be ignored, and
the engine uses the same `MIN_ACTIONABLE_EMOTION_CONFIDENCE` the decision path
does.

## Status of the integration

The engine is complete and tested but **not yet wired into the turn**. Two
follow-ups are required, and both are deliberately out of scope here:

1. `CognitiveContext` gains an `expression` field, composed during assembly.
2. `toneFor` in `@nexa/core`'s generation stage is removed. It currently picks a
   tone from perception and warmth — a narrower version of what `resolveTone`
   now does — and keeping both would be two sources of truth for one decision.

Until then the two coexist, and `toneFor` is the one in use.
