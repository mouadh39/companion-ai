# @nexa/backend

The composition root. The only place a concrete implementation is named.

## What lives here

| File | Role |
|---|---|
| `composition.ts` | Wires ports to implementations. The one file that knows both sides. |
| `server.ts` | HTTP surface — `POST /v1/turn`, `GET /health`. |
| `config.ts` | Environment parsing, validated at startup and never mid-turn. |
| `adapters/` | Milestone 1 shallow adapters. Each graduates into its own package as it becomes real. |

## Why the adapters are here and not in packages

They are temporary wiring, not capabilities. Keeping them in the composition
root means promoting one to `@nexa/memory` changes a single line here and
nothing else.

The point of the vertical slice is that the *seams* are load-bearing now: an
interface designed against imagined callers is wrong in ways that only appear
when a real caller arrives.

## Running

```bash
pnpm --filter @nexa/backend build
pnpm --filter @nexa/backend start
```

`dev` runs the built output under `node --watch`.

## Tests

`test/turn.test.ts` — 9 cases end-to-end over the real graph. The only
substitutions are the clock and the model provider; everything else is
production wiring.
