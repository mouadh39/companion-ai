# @nexa/actions

Validation for the vocabulary clients execute.

The companion never returns text for a client to interpret. It returns actions,
and this package is what guarantees an action leaving the backend is well-formed.

## Where the types live

The `Action` union itself is in `@nexa/models`, one layer below. It is domain
*language*; validation is *behaviour*, and `@nexa/events` and `@nexa/core` both
need to name an action without depending on its validator. The types are
re-exported here so existing importers are unaffected.

## What validation guarantees

A client must never be the first thing to discover an action is malformed. By
the time an action leaves the backend it has been checked here, so a
client-side failure means a protocol bug rather than a bad generation.

Rejected actions are **dropped and reported, never fatal**: one malformed
gesture must not cost the user the answer that came with it. The turn degrades,
which is the behaviour `docs/architecture/05_Data_Flow.md` requires throughout.

## Tests

No test directory yet. `validateAction` is exercised end-to-end through
`apps/backend`'s turn tests. Direct unit tests for the rejection branches are
listed as debt in the Milestone 3.5 report.
