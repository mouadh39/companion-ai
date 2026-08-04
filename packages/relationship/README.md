# @nexa/relationship

Who Nexa and one user are to each other.

Identity is fixed. Personality adapts within a turn. This moves over **months**,
and it is the state that makes a companion different from an assistant — an
assistant speaks the same way to everyone forever, and the same question can
deserve a different answer six months in.

## Position in the graph

```
shared → models → events → core → identity ↗ personality ↗ relationship ↗ apps
```

Depends on `@nexa/models` and nothing above it. No I/O, no clock, no model, no
prompts. The vocabulary lives in `@nexa/models`, because `@nexa/core` may never
import a capability package.

## Two functions

```ts
deriveProfile(relationship, at) → RelationshipProfile   // "who are we right now?"
advance(relationship, signal)   → RelationshipUpdate    // apply one interaction
```

`Relationship` is the stored record — dimensions, counters, timestamps.
`RelationshipProfile` is that record *read at a moment*, with the behavioural
consequences worked out. The same split as `PersonalityProfile` →
`ExpressionProfile`, for the same reason: storing the derived form makes it a
second source of truth, and a relationship is precisely the thing that must not
disagree with its own history.

## Nothing changes fast — and it is structural

Two independent mechanisms, either of which alone would be gameable.

**Every dimension is capped** at `MAX_DIMENSION_DELTA_PER_INTERACTION` (0.02) per
interaction. At full rate an axis takes 50 interactions to cross its range. The
cap is re-applied inside `applyDeltas` rather than trusted from the rule table,
so it holds for a caller supplying its own deltas too.

**Every stage requires three things at once** — interaction count, elapsed days,
*and* dimension thresholds:

| Stage | Reads as | Interactions | Days | Key dimensions |
|---|---|---|---|---|
| `new` | First meeting | — | — | — |
| `acquainted` | Getting acquainted | 5 | 2 | familiarity |
| `familiar` | Regular companion | 25 | 14 | familiarity, trust |
| `close` | Trusted companion | 80 | 60 | + warmth |
| `trusted` | Long-term companion | 200 | 180 | + reliance |

Any one gate alone is trivially defeated: interactions alone advance through
fifty messages in an afternoon, days alone advance through a month of silence,
dimensions alone advance on one unusually good conversation. Requiring all three
means a stage can only be reached by talking regularly, over time, and having it
go well — which is what the word is supposed to mean.

Stage names are the existing `RelationshipType` union rather than new ones.
`@nexa/personality` already reads them, and renaming a shipped closed union to
say the same thing differently is churn that breaks a consumer.

## What moves what

`InteractionSignal` carries **structural facts only** — what kind of exchange it
was, how deep, whether the companion was corrected or admitted uncertainty. No
emotional reading and no content. A relationship built on inferred feelings would
move on the companion's guesses about the user rather than on what actually
happened between them.

- **Familiarity** rises with every exchange. It is the only axis that means "we
  have interacted a lot" rather than a judgement about how it went.
- **Trust** gains a quarter-rate baseline for simply turning up again —
  `reliability` is an identity value, earned by consistency. It gains more from
  being relied on, and most from `emotional_support`.
- **Warmth** comes from casual exchanges, support, and conversations with depth.
- **Reliance** comes only from requests and planning. This is why `trusted` is
  unreachable by confiding alone: a companion confided in but never relied on is
  not a long-term companion.

**Honesty outweighs being wrong.** Acknowledging uncertainty credits trust at
full rate; a correction costs a quarter. A companion that says "I do not know"
and is then corrected ends the exchange slightly *ahead* — which follows from
`honesty` being identity's highest-precedence value.

## Lapsing, decay, and regression

Contact that goes quiet for `LAPSE_AFTER_DAYS` (45) pauses progression and zeroes
reported progress. Not a punishment: a relationship that kept advancing through
six months of silence would say something its own history does not support.

**Only familiarity decays.** Trust and warmth are *earned*, and quietly revoking
them for silence would mean greeting someone returning after a year as though
they had done something wrong. Familiarity is different — it genuinely is a claim
about how current the shared context is. It is floored at 0.1: however long the
silence, the companion has still met this person.

Decay is applied **before** the interaction that ends the gap, so returning
always leaves you better off than staying away.

**Regression is reported, not suppressed.** A relationship that can only advance
is a counter.

## Progression is inspectable

`profile.blockers` names every unmet requirement with `have` and `need`, so "why
are we still just acquainted?" is arithmetic rather than a judgement someone has
to ask for. `profile.progress` is the **minimum** of the per-requirement ratios,
never the mean — a relationship that has the interactions but not a single day of
the elapsed requirement is blocked, and averaging would report progress no amount
of talking today can convert into a stage.

## Replay

`advance` reads no clock; `signal.at` is the only source of time. `replay(from,
signals)` therefore reconstructs a relationship exactly, and the result does not
depend on when the replay runs. That is what makes "how did we get here?"
answerable without having stored every intermediate state.

Order matters — a reordered history is a different relationship. That is the
point: a relationship is a path, not a bag of events, and decay depends on when
the gaps fell.

## Initiative never reaches `lead`

However long the relationship runs. A relationship is not permission to start
conversations — that is `UserPreferences.allowProactiveSpeech`, and letting
closeness reach `lead` on its own would route around a setting the user controls.
`@nexa/personality` enforces the same ceiling from the other side.

## Not implemented here

- **Memories.** Counters record how *often* each kind of exchange happened, never
  what was said. A relationship record accumulating content would be an unmanaged
  second memory store with none of memory's retention or deletion guarantees.
- **Emotion classification.** It reads `intent`, not feelings.
- **Summarisation, prompts, model calls.** None.
- **Persistence.** `advance` returns the next record; storing it is the caller's.

## Tests

| File | What it holds |
|---|---|
| `progression.test.ts` | That a single conversation cannot move the relationship, attacked from the directions most likely to break it. |
| `profile.test.ts` | Derivation, cadence, blockers, and the behavioural consequences. |
| `purity.test.ts` | Purity, replay equivalence, and that the rate cap holds for *any* input. |

## Related decisions

- **ADR-005** — personality is composed per turn; identity is not
