# @nexa/personality

How the companion communicates. Never what it says.

This package turns four inputs into one `ExpressionProfile` per turn. Nothing in
that profile can change a claim, suppress a fact, or alter a decision —
deliberation has already run by the time this is consulted, and it reads none of
this. A companion with low `patience` answers differently; it does not answer
something untrue.

## Position in the graph

```
shared → models → events → core → personality → apps
```

`@nexa/personality` depends on `@nexa/models` and `@nexa/shared`, and on nothing
above them. It implements no port and performs no I/O: loading the stored
`PersonalityProfile` is `PersonalityPort`'s job and stays in the composition
root.

**The vocabulary lives in `@nexa/models`, not here.** `ExpressionProfile`,
`DetailLevel`, `InitiativeLevel`, `Pacing` and the reason codes all sit one layer
down, because `@nexa/core` may never import a capability package — so anything
Core or a sibling engine reads has to be beneath both. That is the same reason
the `Action` union lives in `models` while `@nexa/actions` only validates it.

## The three layers

From `13_Personality_Engine.md`:

| Layer | What | Where it lives | Moves over |
|---|---|---|---|
| 1 · Core identity | Name, values, self-description | `Identity` in `@nexa/models` | Never, without a deliberate revision |
| 2 · Traits | Disposition — warmth, curiosity, directness | `PersonalityProfile.traits` | Months |
| 3 · Adaptive behaviour | Tone, detail, pacing, formality | **This package's output** | Within a turn |

Layer 1 is deliberately untouchable from here. Identity must survive every
personality drift, so the system that adjusts personality must not be able to
reach it.

## The pipeline

Four layers, in ascending order of authority:

```
  base traits  →  relationship  →  conversation context  →  stated preferences
  (disposition)   (earned)         (momentary)              (explicit)
```

Later layers move what earlier ones produced, so precedence is expressed by
position rather than by every layer knowing about the others. Only the base
layer *sets*; the rest adjust. A pipeline that started from a neutral profile and
derived everything from context would produce a companion with no character of
its own — a mirror, which is what the spec rules out.

`composeExpression` is **pure**: no I/O, no clock, no randomness, no model call.
The same request always yields the same profile. That is the bet `deliberate()`
makes, and it buys the same three things — layers testable without stubbing
anything, a profile reproducible offline from a logged request when someone asks
why the companion was curt, and nothing here that can fail in a way that costs
the user their answer.

## Two rules break the gradient

Both break it toward restraint, because the failures they prevent are not
recoverable by the next turn.

**Distress suppresses humour outright.** Not scaled down — driven to zero,
whatever the traits and the relationship say. A playful companion joking at
someone who just said they are struggling is the single most damaging thing this
engine could produce, and the spec is explicit that jokes must never be forced.

**`allowProactiveSpeech: false` caps initiative.** A hard ceiling, not a nudge.
Traits, reliance and an eager mood all push initiative upward and every one of
them loses to this. Capped at `offer` rather than `follow`: the permission
governs speaking *without being addressed*, and within a turn the user has
already addressed the companion — so it may still volunteer something useful.
What it may not do is drive.

`lead` is unreachable from traits alone, by construction.

## Stated outranks inferred, totally

`Relationship.inferredStyle` is what the companion *believes* the user prefers.
`UserPreferences.communicationStyle` is what they *said*. Exactly one is applied,
never both — resolved in the preferences layer, where both are visible.

Applying the guess and then the stated value looks equivalent and is not: an
inferred `detailed` that raised detail by a step is still partly present after a
stated `concise` lowered it, so the stated preference gets the last word without
actually overriding. Choosing between them is what makes the rule total rather
than a matter of which layer happened to run second.

## Weak signals are ignored, not softened

Below `MIN_ACTIONABLE_EMOTION_CONFIDENCE` an emotional reading does not influence
the profile at all — the same threshold the decision path uses. Scaling the
adjustment by confidence would seem gentler and is worse: every low-confidence
guess would still move the output a little, so the companion would be
permanently, slightly wrong about how everyone feels.

## Why `energy` is not a trait

It already exists on `AdaptiveState`. How energetic the companion *is right now*
is state; how warm or direct it *tends to be* is disposition. A duplicate
`energy` trait would give two sources of truth for one quantity, and whichever
layer read the stale one would be wrong in a way nothing detects.

`formality` and `directness` *are* traits, because they are genuine stable
dispositions — some companions are simply blunter than others — and they are
adjusted downstream rather than derived.

## Everything is explained

Every adjustment records an `ExpressionReason` naming its code, the dimensions
it moved, and why. The same bet `Decision.reasonCodes` makes: an adjustment you
cannot account for is one you cannot debug, and "why was it suddenly so formal?"
is otherwise answerable only by re-running the engine by hand.

Reason codes are a closed union rather than free text so they can be counted.
"How often does distress suppress humour?" is a question about product behaviour,
and it is only answerable if the answer is an enumerable token.

## Usage

```ts
import { composeExpression } from '@nexa/personality';

const profile = composeExpression({
  personality,                 // from PersonalityPort
  relationship,                // from RelationshipPort, or null on a first meeting
  perception,                  // from the turn
  recentTurns,                 // from WorkingMemoryPort
  preferences,                 // from the user record
});

profile.tone;        // 'warm' — reuses SpeakAction's vocabulary
profile.detail;      // 'moderate'
profile.humor;       // 0.32
profile.boundaries;  // ['work stress']
profile.rationale;   // why each of the above looks like that
```

Only `personality` and `perception` are required. Each absent input means that
faculty is not composed in — a companion with no relationship record is not
degraded, it is one meeting someone for the first time.

## Tests

| File | What it holds |
|---|---|
| `compose.test.ts` | Purity, input immutability, the rationale contract, and layer precedence. |
| `layers.test.ts` | Each layer in isolation — what it reads and what it must not touch. |
| `safety.test.ts` | The rules that hold whatever else is true, tested against the input most likely to break them. |

`safety.test.ts` sweeps all 880 combinations of trait extreme × emotion × intent
× style and asserts every dimension stays in range. A rule that only holds for
the default personality is not a rule.

## Not implemented here

Deliberately, and each belongs to a different engine:

- **Personality growth.** Traits evolving through experience is a worker
  concern — slow, persisted, and reversible. This package only reads them.
- **Prompt generation.** The profile is structured guidance; rendering it into
  language belongs to the conversation engine.
- **Relationship maintenance.** This reads `Relationship`; it never writes one.
- **Emotion detection.** This reads `Perception.emotion`; producing it is
  perception's job.

## Related decisions

- **ADR-005** — personality is composed per turn, not stored or prompted
- **ADR-002** — the language model is replaceable; personality lives outside it
