# @nexa/models

The domain vocabulary. Every other package speaks this language.

Data and its invariants only — nothing here performs I/O, reads a clock, or
knows how it will be stored. These types are shared by the API process, the
worker and every capability package, so a dependency added here is a dependency
added everywhere.

## Position in the graph

```
shared → models → events → core → capabilities → apps
```

`@nexa/models` depends on exactly one package — `@nexa/shared`, for branded
identifiers — and on nothing above it. **An import in the other direction is a
cycle and is the one rule in this package that must never be relaxed.** It is
enforced structurally: `@nexa/actions` and `@nexa/events` both depend on
`models`, which is why the `Action` union and the `Metadata` value object live
here rather than in the packages that operate on them.

## Layout

| Directory | Holds | Rule |
|---|---|---|
| `types/` | Type-level utilities — the JSON lattice, the `Brand` primitive | Erased at compile time |
| `value-objects/` | Quantities and small immutable values, with their invariants | Branded primitives, never classes |
| `enums/` | Closed vocabularies | String-literal unions + `as const` companions |
| `entities/` | The things the domain is about | Interfaces, never classes |
| `interfaces/` | Structural contracts | Shapes, never behaviour |

Everything is re-exported flat from the package root. **Consumers import from
`@nexa/models`, never from a subpath** — that is what allows the internal layout
to change without a coordinated release across five packages.

## Why unions instead of `enum`

Every closed vocabulary is a string-literal union with an `as const` companion
array:

```ts
export type MemoryType = 'episodic' | 'semantic' | 'procedural' | 'relational' | 'reflective';

export const MEMORY_TYPES = [
  'episodic', 'semantic', 'procedural', 'relational', 'reflective',
] as const satisfies readonly MemoryType[];
```

Three reasons, in order of weight:

1. A union is erased at compile time. A TypeScript `enum` emits a runtime
   object, so importing one for a *type* pulls JavaScript into the bundle and
   breaks under `isolatedModules` + `verbatimModuleSyntax` — both enabled here.
2. The values are what is persisted. `'episodic'` in the database, in the event
   log and in the code is the same token, so there is no mapping layer to get
   wrong.
3. `satisfies` keeps the companion array exhaustive. Adding a union member
   without adding it to the array is a compile error, so the runtime list cannot
   silently fall out of step.

## Why branded scalars

A confidence, an importance and a priority are all `number` at runtime. Without
a brand the compiler lets you pass any one where another belongs — a
substitution that reads correctly and behaves wrongly, producing a companion
that ranks memories by how *sure* it is rather than by how much they *matter*.

```ts
import { confidence, importance } from '@nexa/models';
import type { ImportanceScore } from '@nexa/models';

const c = confidence(0.9);   // ConfidenceScore
const i = importance(0.8);   // ImportanceScore

declare function rank(score: ImportanceScore): void;
rank(c);                     // ✗ compile error — which is the point
```

Constructors throw on out-of-range input, because every internal caller passes a
literal or a domain-derived value, and silently clamping hides the bug where it
is cheapest to find. Untrusted input has a separate door: `parseUnit`,
`parseValence` and `parseTimestamp` return `null` instead of throwing, for
boundaries like a model asked to self-report a confidence.

## Designed for scale

Four decisions that matter at millions of users and years of history:

- **Aggregate roots stay constant-size.** `User` holds no arrays of
  conversations, memories or goals. Every relationship in the docs is a foreign
  key pointing *at* the root, never a collection hanging off it — otherwise the
  one query every request makes becomes the most expensive in the system.
- **`EmbeddingReference`, never the vector.** A 1536-dimension embedding is ~6 KB
  as floats and more as JSON. Inlining it on `Memory` would move kilobytes of
  numbers no reader uses through every retrieval and every context assembly.
- **Cursor pagination, not offsets.** `OFFSET 50000` walks fifty thousand rows to
  discard them, and history is browsed from the far end where offsets are
  largest. Nexa's ids are UUID v7 and already chronologically sortable, so the id
  *is* the cursor.
- **Bounded by construction.** `MAX_ACTIONS_PER_TURN`, `MAX_METADATA_KEYS`,
  `MAX_PAGE_SIZE`, `MAX_MESSAGE_LENGTH` — each caps a worst case on a path that
  runs every turn.

## What does not belong here

- **Repositories and services.** Ports are declared by `@nexa/core`, because the
  layer that orchestrates must own the interfaces it calls.
- **Business logic.** Value-object invariants are the only runtime behaviour;
  everything else is types.
- **The event envelope, bus, transports and catalogue.** All of those are
  `@nexa/events`. The envelope in particular carries `source`, `durability` and
  `causedBy` — fields only the bus can stamp — so it belongs with the bus. What
  this package keeps is `EventAggregate` and `aggregateOf`, which map a
  namespaced type string to the subject it is a fact about, and are readable
  from a persisted row with no dependency on the transport that wrote it.
- **Action validation.** That is `@nexa/actions`, which re-exports the types
  defined here.

## Tests

`packages/models/test/value-objects.test.ts` covers the value-object invariants —
the only part of this package that can fail at execution time, and the only place
a bad value can enter the domain and be persisted. The types themselves are
checked by the compiler.

Tests import through the package's `exports` map, so they run against built
output. `turbo` builds first:

```bash
pnpm --filter @nexa/models test
```
