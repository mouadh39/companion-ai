# @nexa/memory

What should be remembered, and why.

**Formation only.** No database, no embeddings, no retrieval, no prompts, no
model calls. It answers one question about one proposal: does this earn a place,
and if so as what?

## Position in the graph

```
shared → models → … → identity ↗ personality ↗ relationship ↗ memory ↗ apps
```

Depends on `@nexa/models` and nothing above it.

## Two functions

```ts
decide(request)          → FormationDecision   // store | reinforce | supersede | reject
forgetCheck(memory, at)  → ForgetDecision | null
```

Both pure and total — no clock, no randomness, no throw. `at` is always supplied
and `existing` is always passed in, which is what makes a formation history
replayable: re-running a user's proposals reconstructs exactly the store they
have, and "why do you think that about me?" is answerable from the recorded
reasons rather than from a guess.

## Retrieval is somebody else's job

`FormationRequest.existing` is **supplied by the caller**, never looked up.
Deciding what to remember and finding what is already remembered are different
problems. Fusing them would make this engine impossible to test without a store,
and impossible to reason about when the store is slow.

## Two taxonomies, deliberately orthogonal

| | Says | Governs |
|---|---|---|
| `MemoryType` (episodic, semantic, …) | how it is encoded | how it is **retrieved** |
| `MemorySubject` (identity, preference, …) | what it is about | how long it **lives** |

They cross freely. *"They got the promotion"* is `episodic` + `milestone`;
*"they are a nurse"* is `semantic` + `identity`. Collapsing them into one enum
would force a choice between retrieving well and retaining well, and the same
memory would be mis-served by whichever axis lost.

**Retention policy attaches to the subject.**

| Subject | Importance floor | Confidence floor | TTL | Supersedable |
|---|---|---|---|---|
| `identity` | 0.50 | 0.60 | never | yes |
| `milestone` | 0.40 | 0.50 | never | **no** |
| `goal` | 0.35 | 0.45 | 180d | yes |
| `relationship` | 0.35 | 0.50 | 730d | yes |
| `preference` | 0.30 | 0.45 | 730d | yes |
| `project` | 0.30 | 0.45 | 365d | yes |
| `temporary` | 0.10 | 0.30 | 1d | yes |

The asymmetry is the design. Getting an `identity` fact wrong is expensive and
lacking it is worse, so it demands high confidence and keeps it forever. A
`temporary` fact is cheap to lose and cheap to re-derive. One policy for both
would either fill the store with noise or drop what the companion most needs.

**A milestone is never superseded.** A thing that happened does not stop having
happened; replacing it would rewrite history rather than update a belief. When a
milestone conflicts, both are kept and the disagreement is left for reflection.

## The gates, in order

1. **Permission.** `allowMemoryFormation: false` rejects everything, including
   an explicit request. The one gate that is not a judgement.
2. **Substance.** Nothing to remember.
3. **Classification and scoring.**
4. **What already exists** — duplicate, conflict, or new.
5. **Thresholds.**

Thresholds run *last* so a rejected proposal still carries the reasons
explaining what it was judged as. A rejection with no explanation is one nobody
can tune.

## Confidence comes from provenance

The only confidence signal available without a model, and a good one —
`18_Memory_Architecture.md` already establishes that `user_stated` outranks
`reflection` when two memories conflict, and these numbers are that rule made
arithmetic:

`user_stated` 0.90 · `conversation` 0.70 · `observation` 0.65 · `reflection` 0.50

Reflection is lowest deliberately: a conclusion drawn from other memories
inherits all their errors and adds its own.

## Reinforcement, and why it is small

A restatement reinforces rather than storing a second copy — confidence +0.05
max, importance +0.03 max. Saying a thing twice is evidence; saying it twenty
times must not manufacture certainty the source cannot support.

Reinforcement takes the **later** of the current expiry and the extension, so it
can only ever lengthen a life. Setting expiry to `at + extension` unconditionally
looks equivalent and is not — a young memory with a long TTL would have its
expiry pulled *closer* by being mentioned again.

Decay is measured from the last reinforcement, not from creation. Measured from
creation, a memory recalled weekly would decay on the same schedule as one never
mentioned again, and the counter would be decorative.

## Conservative under uncertainty

Similarity here is **lexical** — Jaccard overlap of suffix-normalised content
words, plus explicit negation detection. It catches restatements that share
vocabulary and **cannot** catch a paraphrase that does not: *"I'm vegetarian"*
and *"I don't eat meat"* score near zero and are the same fact.

That gap is accepted rather than papered over. Closing it needs semantic
comparison, which needs embeddings, which this engine may not use. So the engine
is tuned toward the *cheap* failure: an undetected duplicate becomes a second
memory that retrieval will surface alongside the first and reflection can merge.
A false duplicate would silently discard something true — much worse, and much
harder to notice.

The stop list is deliberately small for the same reason. An aggressive one would
strip *"not"*, and *"I like coffee"* versus *"I do not like coffee"* would become
identical — turning a contradiction into a duplicate.

Classification falls back to `temporary` when unsure, because that is the cheap
wrong answer: a misclassified temporary memory expires in a day, a misclassified
identity memory is asserted about the user forever.

## The user's retention limit wins

`UserPreferences.memoryRetentionDays` applies whenever it is shorter — including
over subjects that would otherwise never expire. Memory is the user's property;
a retention setting that identity facts could ignore would be a setting that does
not mean what it says.

## Forgetting is not deletion

A `ForgetDecision` says a memory should stop being *retrieved*. Nothing here
removes anything, and only `user_deleted` is ever meant to erase — `superseded`
and `merged` keep the original readable so history stays intact.

## Not implemented here

- **Retrieval, ranking, embeddings, vector search.** `existing` is passed in.
- **Persistence.** `decide` returns a draft; storing it is the caller's.
- **Ids.** Stamped outside, so the engine stays free of randomness — the same
  rule `deliberate()` follows.
- **Emotional charge.** `valence` is left neutral; classifying feelings is the
  emotion engine's job.
- **Consolidation and merging.** Reflection's.

## Tests

| File | What it holds |
|---|---|
| `formation.test.ts` | The gates, the four outcomes, retention, and purity. |
| `lifecycle.test.ts` | Classification, similarity, forgetting, and policy coherence. |
