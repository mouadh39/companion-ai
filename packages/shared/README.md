# @nexa/shared

Pure primitives. No domain knowledge, no dependencies.

The contract is deliberately narrow, because the alternative has a name: a
`utils` package, which accretes whatever has no other home and quietly becomes a
coupling point between modules that should not know about each other. Anything
added here must be dependency-free, domain-free, and individually justified.

## Contents

| Module | Why it earns its place |
|---|---|
| `ids` | Branded identifiers + `uuidv7`. Time-ordered ids make the event log range-scannable without a separate timestamp index. |
| `result` | `Result<T, E>` for expected failures, so a provider timeout is a value rather than an exception. |
| `clock` | `Clock` port + `FixedClock`. Deliberation is pure; time is injected so any turn replays identically. |
| `errors` | `NexaError` and friends, each carrying a stable `code` that tooling can aggregate. |

## Position

```
shared → models → events → core → capabilities → apps
```

Bottom of the graph. It imports nothing from the workspace, and everything else
may import it.

## Tests

No test directory. The identifier and clock behaviour is exercised through the
packages that consume it; `turbo run test` reports an honest zero here rather
than skipping the package silently.
