# Nexa

An AI companion that lives in the user's real environment.

Nexa is not a chatbot with a 3D model attached. The intelligence — identity,
memory, goals, personality, deliberation — lives in a backend that knows nothing
about rendering. Unity is one client among several, and the language model is a
replaceable implementation detail behind a single port.

This repository contains the **Nexa Cognitive Core**: the turn pipeline, the
ports it depends on, and the execution policy every stage shares.

## The turn

One user message in, a set of actions out, through a synchronous ordered
pipeline:

```
admission → perception → context assembly → deliberation
          → generation → validation → commit → publish
```

Three properties are load-bearing, and most of the design follows from them:

- **Context assembly is the only stage that performs I/O.** One place to enforce
  the token budget, one place to schedule, one place to apply deadlines — which
  is what allows the next stage to be a pure function.
- **Deliberation is pure.** `deliberate(context)` is deterministic and free of
  randomness and I/O, so a decision is reproducible from its input and
  explainable without a trace. A model may still advise it, through
  `DecisionAdvisorPort`, which runs in the *last assembly wave* so its output is
  an input to the pure function rather than a call made from inside one.
- **A turn degrades rather than fails.** A slow world model costs a context
  section, never the answer. Only identity and personality are fatal.

## Packages

Dependencies point in one direction. An import against the arrows is a cycle,
and it is the rule that must never be relaxed.

```
shared → models → events → core → providers → apps
                → actions ↗
```

| Package | Role |
|---|---|
| `@nexa/shared` | Pure primitives — branded ids, `Result`, `Clock`. No domain knowledge. |
| `@nexa/models` | The domain vocabulary. Data and its invariants only; no I/O, no clock. |
| `@nexa/events` | The envelope, the typed bus, and the event catalogue. |
| `@nexa/actions` | Validation for the vocabulary clients execute. |
| `@nexa/core` | The cognitive turn, the ports, and the execution policy. Owns no engine. |
| `@nexa/providers` | Language model implementations behind `LanguageModelPort`. |
| `@nexa/backend` | The composition root — the only place a concrete implementation is named. |

`@nexa/core` never imports a capability package. It declares the interfaces;
capability packages implement them; `apps/backend/src/composition.ts` wires them.
That direction is what keeps the intelligence's shape testable without standing
up the system.

## Getting started

Requires Node ≥ 22 and pnpm 9.

```bash
pnpm install
pnpm verify        # build, lint, typecheck, test
```

Run the backend:

```bash
pnpm --filter @nexa/backend build
pnpm --filter @nexa/backend start
```

The provider defaults to `scripted`, so the full pipeline runs offline and
deterministically with no configuration at all. For Anthropic:

```bash
NEXA_MODEL_PROVIDER=anthropic ANTHROPIC_API_KEY=sk-... pnpm --filter @nexa/backend start
```

Both are validated at startup — asking for `anthropic` without a key fails
immediately rather than on the first turn that needs it.

| Variable | Default | Meaning |
|---|---|---|
| `NEXA_MODEL_PROVIDER` | `scripted` | `anthropic` or `scripted` |
| `ANTHROPIC_API_KEY` | — | Required when the provider is `anthropic` |
| `NEXA_MODEL_ID` | `claude-opus-5` | Model to request |
| `HOST` / `PORT` | `0.0.0.0` / `3000` | HTTP bind |
| `LOG_LEVEL` | `info` | Fastify log level |

```bash
curl -X POST localhost:3000/v1/turn \
  -H 'content-type: application/json' \
  -d '{"companionId":"...","userId":"...","text":"where are my keys?"}'
```

## Verification

```bash
pnpm verify         # everything
pnpm test           # tests only
pnpm --filter @nexa/core test
```

Tests import through each package's `exports` map and therefore run against
built output, which is why the Turborepo `test` task depends on `build`. A test
exercises exactly what other packages import, rather than a source-only reality
where the published entry point is never checked.

## Documentation

| Where | What |
|---|---|
| `docs/00_Vision.md`–`02_Core_Principles.md` | What Nexa is and the principles it is held to |
| `docs/architecture/` | System, data flow, event system, backend and API architecture |
| `docs/decisions/` | ADRs — the decisions and what was rejected |
| `docs/specifications/` | Normative contracts, including the Event API |
| `packages/*/README.md` | Per-package boundaries and the reasoning behind them |

The ADRs are the fastest way in. ADR-006 (port tiers), ADR-007 (contributor
graph, and why there is no blackboard), ADR-008 (deadlines and cancellation) and
ADR-009 (the bounded tool loop) cover most of what is non-obvious in Core.

## Unity client

`Unity/Nexa/` is an AR client. It renders actions and captures input; it holds no
intelligence. See ADR-001 for what that constraint buys and what it costs.

## Licence

MIT. See [LICENSE](LICENSE).
