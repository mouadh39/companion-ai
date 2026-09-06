import {
  systemClock,
  newTurnId,
  type Clock,
  type CompanionId,
  type UserId,
} from '@nexa/shared';
import {
  InProcessEventBus,
  actionExecuted,
  actionFailed,
  type EventBus,
  type EventCorrelation,
} from '@nexa/events';
import {
  ActionGenerator,
  CognitiveTurn,
  ContextAssembler,
  Deadline,
  defaultAssemblerOptions,
  InMemoryIdempotencyStore,
  InProcessTurnGate,
  RecordingMetrics,
  noopObservability,
  type ContextPorts,
  type IdempotencyStore,
  type EmbeddingPort,
  type LanguageModelPort,
  type Observability,
  type PerceptionPort,
  type PortOptions,
  type TurnGate,
  type TurnResult,
  type WorkingMemoryPort,
} from '@nexa/core';
import {
  AnthropicLanguageModel,
  GroqLanguageModel,
  HeuristicTokenEstimator,
  OpenAiEmbeddingProvider,
  ScriptedLanguageModel,
} from '@nexa/providers';
import type {
  ActionOutcome,
  BodyActivity,
  ActionType,
  DeviceDescriptor,
  FacultyKey,
  SkillDescriptor,
} from '@nexa/models';
import { succeeded } from '@nexa/models';
import type { AppConfig } from './config.js';
import { PerceptionEngine } from './adapters/perception.js';
import { IdentityEngine, PersonalityExpression } from './adapters/engines.js';
import {
  MemoryFormation,
  PlanningAdvisor,
  RelationshipRecord,
  RetrievalEngine,
} from './adapters/cognition.js';
import { TurnScratchpad } from './adapters/scratchpad.js';
import { EmbodimentState } from './adapters/embodiment.js';
import { SelfModel } from './adapters/self.js';
import { SupabaseAuthenticator } from './auth/supabase.js';
import { SupabaseJwksAuthenticator } from './auth/supabase-jwks.js';
import { DenyAllAuthenticator } from './auth/deny-all.js';
import { DeviceTokenAuthenticator } from './auth/device-token.js';
import { CompositeAuthenticator } from './auth/composite.js';
import {
  ClaimOnFirstUseBindings,
  PgCompanionBindings,
  type CompanionBindingStore,
} from './auth/bindings.js';
import type { AuthenticationPort } from './auth/port.js';
import {
  InMemoryDeviceStore,
  PgDeviceStore,
  type DeviceStore,
} from './devices/store.js';
import {
  InMemoryEnrolmentStore,
  PgEnrolmentStore,
  type EnrolmentStore,
} from './devices/enrolments.js';
import {
  InMemoryPairingSessionStore,
  PgPairingSessionStore,
  DenyAllPairingSessionStore,
  type PairingSessionStore,
} from './devices/pairing-sessions.js';
import { InMemoryProfileStore, PgProfileStore, type ProfileStore } from './profile/store.js';
import {
  InMemoryDeviceTokenStore,
  PgDeviceTokenStore,
  DenyAllDeviceTokenStore,
  type DeviceTokenStore,
} from './devices/tokens.js';
import {
  InMemoryInsightStore,
  InMemoryMemoryStore,
  InMemoryRelationshipStore,
  randomIds,
  type IdSource,
} from './adapters/stores.js';
import { Pool } from 'pg';
import { Consolidation } from './workers/consolidation.js';
import {
  PgInsightStore,
  PgMemoryStore,
  PgRelationshipStore,
  PgWorkingMemory,
} from './adapters/postgres/stores.js';
import type {
  InsightStore,
  MemoryStore,
  RelationshipStore,
} from './adapters/store-ports.js';
import {
  InMemoryPersonality,
  InMemoryWorkingMemory,
  NoGoals,
  NoTools,
} from './adapters/in-memory.js';

/**
 * The composition root.
 *
 * **This is the only place in the system that names a concrete implementation.**
 * Core declares ports; capability packages implement them; everything meets
 * here. That is what makes swapping a provider, a memory store, or an entire
 * transport a change to this file rather than a change to the intelligence.
 *
 * It mirrors the rule already enforced in the Unity client, where `Nexa.App` is
 * the sole assembly permitted to name concrete AR types.
 *
 * Composition proceeds in layers, and the order is the dependency order:
 *
 * ```
 *   config → infrastructure → stores → capabilities → core → post-turn
 * ```
 *
 * ## Every cognitive adapter is now a real engine
 *
 * Phase A built nine engines and wired none of them. This file is where that
 * changed. `StaticIdentity`, `HeuristicPerception`, `EmptyMemoryRetrieval` and
 * `RecordingMemoryWrite` are gone; identity, personality, perception, retrieval,
 * planning, memory formation, relationship and reflection all run for real.
 *
 * What remains in-memory are *stores* — working memory, long-term memory,
 * insights, relationship records. Those were never the intelligence, and each is
 * a seam a durable implementation replaces without anything else moving.
 *
 * ## Three timescales, not one pipeline
 *
 * The engines do not form a nine-stage sequence, and wiring them as one would
 * put pattern discovery over a user's whole history on the latency path:
 *
 * - **Standing state** — identity, personality, relationship. Read per turn.
 * - **In-turn, synchronous** — perception, then retrieval, then planning, then
 *   generation. The only genuine sequence.
 * - **Post-turn, on the bus** — memory formation, reflection, relationship
 *   progression. Core publishes; consumers listen.
 */

export interface Application {
  readonly turn: CognitiveTurn;
  readonly events: EventBus;
  readonly clock: Clock;
  readonly modelName: string;
  /**
   * Exposed for tests to assert on, and as the seam a `/metrics` surface will
   * read from. No such route exists yet — the recorder is in-process only.
   */
  readonly metrics: RecordingMetrics;
  /**
   * The cognitive state the engines built up.
   *
   * Exposed so integration tests and the replay harness can assert on what the
   * architecture actually did, rather than inferring it from an HTTP response.
   * Nothing in the request path reads this.
   */
  readonly cognition: CognitionSurface;
  /**
   * Proves who is calling. The only source of a trusted `UserId`.
   *
   * On the application rather than inside the HTTP layer so a second
   * transport cannot accidentally acquire a different one — two ways to
   * authenticate is two boundaries to keep correct.
   */
  readonly auth: AuthenticationPort;
  /** Which companions an account may act as. */
  readonly bindings: CompanionBindingStore;
  /**
   * The physical devices on an account — a phone, or a headset that has
   * paired.
   *
   * Not to be confused with the `DeviceDescriptor` vocabulary in
   * `@nexa/models`, which describes hardware a *body* reports (microphone,
   * camera, controller) and is held in memory. These are account-owned and
   * durable, and the two share only a word.
   */
  readonly devices: DeviceStore;
  /**
   * Headsets that have published a public key but not yet been paired to
   * an account. Distinct from `devices`: an enrolment grants nothing and
   * belongs to no user until a pairing session consumes it.
   */
  readonly enrolments: EnrolmentStore;
  /**
   * Pairing sessions — one authenticated phone's live attempt to bind a
   * specific headset key to its account. Creating one consumes the
   * enrolment it names; see `PairingSessionStore`.
   */
  readonly pairingSessions: PairingSessionStore;
  /**
   * A headset's refresh-token families — created once, at redemption, by
   * `pairingSessions.redeem`, and renewed from here by
   * `POST /v1/devices/token/refresh`. Never consulted for phone
   * authentication, which stays entirely on `auth`.
   */
  readonly deviceTokens: DeviceTokenStore;
  /**
   * What onboarding has collected about each account — first name, username,
   * date of birth, and whether all three are in yet. Authentication answers
   * who is calling; this is where the answer to "what has Nexa learned about
   * them" lives, deliberately kept apart from it.
   */
  readonly profiles: ProfileStore;
  /**
   * Records what a client's body did with an action it was given.
   *
   * On the application surface rather than reached through `cognition` because
   * the HTTP layer calls it directly: an outcome is not part of a turn and must
   * not be routed through one. Publishing the event is done here rather than in
   * the route, so every path that records an outcome — HTTP now, a socket or a
   * queue later — emits it, and the reflection engine subscribes once.
   */
  reportActionOutcome(
    companionId: CompanionId,
    userId: UserId,
    outcome: ActionOutcome,
  ): Promise<void>;
  /** Records what the body says it is doing now, independent of any one action. */
  observeBody(
    companionId: CompanionId,
    observation: {
      readonly activity: BodyActivity;
      readonly following: string | null;
      readonly canPerform: readonly ActionType[];
      readonly devices?: readonly DeviceDescriptor[];
      readonly skills?: readonly SkillDescriptor[];
    },
  ): void;
  shutdown(): Promise<void>;
}

/** What the engines produced, for tests, the harness, and a future debug route. */
export interface CognitionSurface {
  readonly scratchpad: TurnScratchpad;
  /**
   * The session history, behind the same port Core writes through.
   *
   * Exposed so a test can prove the *caller* scopes a turn to its owner. The
   * long-term stores below would look correct even if Core appended every
   * turn under the wrong user, because they are a different store.
   */
  readonly workingMemory: WorkingMemoryPort;
  readonly memories: MemoryStore;
  readonly insights: InsightStore;
  readonly relationships: RelationshipStore;
  readonly formation: MemoryFormation;
  readonly consolidation: Consolidation;
  /**
   * What the body reported. Exposed so a test can prove the *loop* closed —
   * that an outcome posted to the ingress reaches the next turn's context —
   * rather than inferring it from a generated sentence.
   */
  readonly embodiment: EmbodimentState;
  /**
   * The resolver, exposed so a test can drive it with the same real inputs the
   * pipeline gives it. Nothing on the request path reads this.
   */
  readonly selfModel: SelfModel;
}

export interface CompositionOverrides {
  /**
   * Substitutes the authenticator.
   *
   * The seam the offline suites use. The real Supabase verifier is still
   * exercised — against tokens signed locally with a test secret — so this
   * is for tests that care about what happens *after* admission, not for
   * skipping it.
   */
  readonly auth?: AuthenticationPort;
  /** Substitutes the binding store, so a test can bind without a database. */
  readonly bindings?: CompanionBindingStore;
  /** Substitutes the device store, so a test can register without a database. */
  readonly devices?: DeviceStore;
  /** Substitutes the enrolment store, so a test can enrol without a database. */
  readonly enrolments?: EnrolmentStore;
  /** Substitutes the pairing-session store, so a test can create sessions without a database. */
  readonly pairingSessions?: PairingSessionStore;
  /** Substitutes the device-token store, so a test can refresh without a database. */
  readonly deviceTokens?: DeviceTokenStore;
  /** Substitutes the profile store, so a test can exercise onboarding without a database. */
  readonly profiles?: ProfileStore;
  readonly clock?: Clock;
  readonly languageModel?: LanguageModelPort;
  /**
   * Substitutes the embedding provider.
   *
   * `null` is meaningful and distinct from omitted: it forces lexical-only
   * retrieval even where a key is configured, which is how a test pins the
   * pre-Step-3 behaviour.
   */
  readonly embedder?: EmbeddingPort | null;
  readonly observability?: Observability;
  /**
   * Substitutes perception.
   *
   * Retained as a seam for a test that needs a reading the real engine would not
   * produce. It is no longer needed to reach the confident-emotion paths: the
   * real engine reports a stated feeling well above the actionable floor, which
   * the placeholder it replaced never did.
   */
  readonly perception?: PerceptionPort;
  /**
   * Where stored identifiers come from.
   *
   * Injected so the replay harness can make a whole run reproducible, ids
   * included. Production uses the real generators. No engine is aware either
   * exists — every one already refuses to mint an id, which is what makes this
   * substitutable at all.
   */
  readonly ids?: IdSource;
}

const selectLanguageModel = (
  config: AppConfig,
  overrides: CompositionOverrides,
): LanguageModelPort => {
  if (overrides.languageModel !== undefined) return overrides.languageModel;

  if (config.provider === 'anthropic' && config.anthropicApiKey !== null) {
    return new AnthropicLanguageModel({
      apiKey: config.anthropicApiKey,
      model: config.modelId,
      effort: 'low',
      timeoutMs: config.providerTimeoutMs,
    });
  }

  if (config.provider === 'groq' && config.groqApiKey !== null) {
    return new GroqLanguageModel({
      apiKey: config.groqApiKey,
      model: config.modelId,
      timeoutMs: config.providerTimeoutMs,
    });
  }

  // The scripted model is the floor, not a fallback for a misconfigured
  // provider: `loadConfig` refuses to start without the selected provider's
  // key, so reaching here means `scripted` was asked for.
  return new ScriptedLanguageModel();
};

/**
 * Port options for a write that does not belong to a turn.
 *
 * `PortOptions` is shaped for the turn pipeline — a deadline carved out of the
 * turn's budget, and the turn's id for correlation — and an action outcome has
 * neither. It arrives from a body on its own schedule, long after the turn that
 * generated the action returned.
 *
 * Rather than widen the type for one caller, a fresh short-budget deadline and
 * a fresh id are minted here. The id is honest: this write really is its own
 * unit of work, and correlating it to the originating turn is what
 * `ActionOutcome.turnId` is for.
 */
const OUT_OF_TURN_BUDGET_MS = 5_000;

const outOfTurnOptions = (clock: Clock): PortOptions => ({
  signal: new AbortController().signal,
  deadline: Deadline.after(clock, OUT_OF_TURN_BUDGET_MS),
  turnId: newTurnId(),
});

export const compose = (
  config: AppConfig,
  overrides: CompositionOverrides = {},
): Application => {
  // Decided first: it sets the budgets for everything below, because those
  // budgets are really a statement about how far away the data is.
  //
  // `??` rather than `=== null`: a config assembled in a test may omit the
  // field entirely, and `undefined` would otherwise build a pool that quietly
  // defaults to localhost:5432 instead of staying in memory.
  const databaseUrl = config.databaseUrl ?? null;

  // ── infrastructure ────────────────────────────────────────────────────────
  const clock = overrides.clock ?? systemClock;

  // In-process for now. Swapping to a durable transport is a change here and
  // nowhere else — no handler edits, no interface change.
  const events = new InProcessEventBus(
    clock,
    (error, context) => {
    // A handler failure is logged and contained. It must never reach the
    // publisher, because by the time events are emitted the turn has already
    // succeeded and the user is owed their answer.
      console.error('[nexa] event handler failed', {
        eventId: context.eventId,
        eventType: context.eventType,
        error: error instanceof Error ? error.message : String(error),
      });
    },
    // Post-turn work reaches the same database the turn did. The default
    // budget assumes handlers that touch nothing slower than memory.
    databaseUrl === null ? {} : { handlerTimeoutMs: 30_000 },
  );

  const metrics = new RecordingMetrics();
  const observability: Observability =
    overrides.observability ?? { ...noopObservability, metrics };

  // ── stores ────────────────────────────────────────────────────────────────
  // The one decision that makes memory durable. Everything above and below
  // this block is identical either way: the stores satisfy the same
  // interfaces, so Core, the engines and every client are unaware which is
  // bound. Absent DATABASE_URL the in-memory stores keep the previous
  // behaviour, which is what lets the unit suites and the replay harness run
  // with no database at all.
  const ids = overrides.ids ?? randomIds;
  const pool =
    databaseUrl === null
      ? null
      : new Pool({
          connectionString: databaseUrl,
          // Supabase terminates unencrypted connections; the pooler presents a
          // certificate this process has no local root for, which is a
          // deployment concern rather than a reason to fall back to plaintext.
          ssl: { rejectUnauthorized: false },

          /*
           * Survive a conversational pause.
           *
           * `pg` closes an idle connection after 10 seconds, which is a sensible
           * default for a request/response API and the wrong one for a companion
           * someone talks to. The gap between two spoken sentences is routinely
           * longer than that, so the pool was empty at the start of nearly every
           * real turn and the turn paid to open it again: measured here at 737 ms
           * cold against 79 ms warm, and about 1.2 s on the turn as a whole
           * (2946 ms after a 15-second pause versus 1598 ms back-to-back).
           *
           * Five minutes covers the pauses a conversation actually has without
           * holding connections open indefinitely. It is deliberately a timeout
           * rather than `0`: a process that has genuinely stopped talking to the
           * database should eventually let go of its backends.
           */
          idleTimeoutMillis: 300_000,

          /*
           * A connection held for minutes is a connection something in the middle
           * may quietly discard. TCP keepalives stop a NAT or firewall from
           * dropping an idle socket and leaving the pool holding a handle that
           * only fails when a turn tries to use it. `pg` removes a client that
           * errors while idle, so a connection lost anyway is discarded rather
           * than handed to a turn — the keepalive is what makes that rare instead
           * of routine.
           */
          keepAlive: true,
          keepAliveInitialDelayMillis: 10_000,
        });

  // An error on an *idle* pooled client — the Supabase pooler recycling a
  // backend, a network blip on a long-lived socket — is emitted on the pool
  // itself, not on any query. `pg` has already discarded the bad client by
  // the time this fires, so the next query simply opens a fresh one; the only
  // thing left to do is not let Node treat an unhandled 'error' as a fatal
  // uncaught exception. Logged, swallowed. A query that genuinely cannot
  // reach the database still rejects at its own call site, unchanged.
  if (pool !== null) {
    pool.on('error', (error: Error) => {
      console.error('[nexa] idle database client error', { error: error.message });
    });
  }

  const workingMemory: WorkingMemoryPort =
    pool === null ? new InMemoryWorkingMemory() : new PgWorkingMemory(pool);
  const memories: MemoryStore =
    pool === null ? new InMemoryMemoryStore(ids) : new PgMemoryStore(pool, ids);
  const insights: InsightStore =
    pool === null ? new InMemoryInsightStore(ids) : new PgInsightStore(pool, ids);
  const relationships: RelationshipStore =
    pool === null
      ? new InMemoryRelationshipStore(ids)
      : new PgRelationshipStore(pool, ids);

  // What the engines produced for the turn in flight. The composition root owns
  // it because it is the only place allowed to know that retrieval and planning
  // both want what perception made — see `scratchpad.ts`.
  const scratchpad = new TurnScratchpad();

  // ── capabilities ──────────────────────────────────────────────────────────
  /**
   * The embedding provider, or nothing.
   *
   * Overridable so tests get deterministic vectors with no key and no network
   * — the same seam `languageModel` uses. Absent entirely, memories are stored
   * without vectors and retrieval ranks on its other four signals, which is
   * exactly the behaviour that shipped before Step 3.
   */
  // `?? null` rather than `=== null`, for the same reason `databaseUrl` needs
  // it: a config assembled in a test may omit the field, and `undefined`
  // would otherwise construct a provider with no key and start making
  // network calls from a suite that is supposed to be offline.
  const openAiApiKey = config.openAiApiKey ?? null;
  const embedder: EmbeddingPort | null =
    overrides.embedder !== undefined
      ? overrides.embedder
      : openAiApiKey === null
        ? null
        : new OpenAiEmbeddingProvider({
            apiKey: openAiApiKey,
            model: config.embeddingModel ?? 'text-embedding-3-small',
            dimensions: config.embeddingDimensions ?? 1_536,
          });

  const memoryWrite = new MemoryFormation({
    store: memories,
    scratchpad,
    clock,
    embedder,
    onEmbeddingError: (error) => {
      // Contained. The memory is already written; it is merely not searchable
      // by meaning until the backfill reaches it.
      console.error('[nexa] embedding failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    },
  });

  /**
   * The body's own account of itself.
   *
   * Always composed, even with no client attached. An embodiment capability
   * that has never heard from a body reports `unknownBodyState` — activity
   * unknown, nothing performable, stale — which is the honest answer and the
   * one that keeps generation from claiming a physical result. Composing it
   * conditionally would mean the *absence* of a body and the *silence* of one
   * were the same value, and they are not.
   */
  const embodiment = new EmbodimentState({ clock });

  // Selected before the ports so the faculty list can read what the provider
  // can actually do. Nothing else about the ordering changes.
  const languageModel = selectLanguageModel(config, overrides);

  /**
   * Which faculties this deployment actually composed.
   *
   * Stated here because this is the only place that knows. `@nexa/self` refuses
   * to discover it — a self model that inspected the running system would drift
   * from the wiring the moment either changed, and would need to know about
   * `PortMap`, which sits above it.
   *
   * The list is derived from real conditions, not asserted:
   *
   * - `long_term_memory` follows the embedder and the store actually bound. A
   *   deployment with no database still retrieves, so this is not conditioned on
   *   the pool; a deployment that lost retrieval entirely would drop it here and
   *   the companion would stop claiming recall.
   * - `locomotion`, `attention` and `gesture` follow the embodiment capability.
   *   They are backend-side *faculties* — the ability to issue and account for
   *   the action — not the body's ability to perform it, which the body reports
   *   separately and which narrows the result further.
   * - `speech_in` and `speech_out` are deliberately **absent**. Recognition and
   *   synthesis live entirely in the client; the backend neither performs nor
   *   verifies them. Claiming them here would be this process asserting a
   *   faculty it does not have, which is the exact failure the Self Model
   *   exists to prevent. They become resolvable when the client reports its
   *   microphone and speaker as devices.
   * - `vision`, `world_model`, `planning` and `tools` are absent because nothing
   *   implements them. Their catalogue entries are `planned`, so they resolve
   *   `not_built` before any faculty check is reached.
   */
  const composedFaculties: readonly FacultyKey[] = [
    'long_term_memory',
    'locomotion',
    'attention',
    'gesture',
    // Streaming is a provider capability rather than a wired port, so it is
    // read from the model that was actually selected.
    ...(languageModel.capabilities.streaming ? (['streaming'] as const) : []),
  ];

  /**
   * Faculties a connected client may supply.
   *
   * Speech only, and for a reason rather than for convenience: recognition and
   * synthesis run entirely in the client, this process neither performs nor
   * verifies them, and a connected microphone genuinely is what makes hearing
   * possible. Listing them lets a reported microphone and speaker resolve
   * `hear_speech` and `speak_aloud` without this process pretending to own
   * either.
   *
   * `vision` is deliberately absent. A client may report a camera perfectly
   * truthfully; turning frames into understanding is work this side would have
   * to do and has not been built, so the capability stays `not_composed`. That
   * asymmetry is the whole trust rule: a client supplies evidence about its
   * environment, never permission.
   */
  const clientProvidableFaculties: readonly FacultyKey[] = [
    'speech_in',
    'speech_out',
    'hearing',
  ];

  /**
   * Who is allowed to call, and as whom.
   *
   * With no Supabase secret configured this is `DenyAllAuthenticator`, which
   * refuses everything. That is deliberate and is the only direction this may
   * fail in: a deployment that forgot to configure authentication serves
   * 401s, rather than falling back to trusting whatever a caller puts in the
   * body — which is precisely the hole this step exists to close.
   *
   * A headset's `nexa-device` token is accepted only when
   * `NEXA_DEVICE_TOKEN_SECRET` is configured, composed alongside Supabase via
   * `CompositeAuthenticator` rather than replacing it — a missing device
   * secret must never affect phone/Supabase authentication, and it does not:
   * the two are read from independent config fields and built independently
   * below.
   */
  // A project on asymmetric JWT signing (`SUPABASE_URL` set) has no shared
  // secret to give this backend — it publishes a rotating public key set.
  // That path wins when configured; the HS256 shared-secret path is the
  // fallback for a project that still uses one; a project that configures
  // neither still denies everything, which stays the only safe failure.
  const supabaseUrl = config.supabaseUrl ?? null;
  const supabaseAuthenticator: AuthenticationPort = supabaseUrl !== null
    ? new SupabaseJwksAuthenticator({
        jwksUrl: new URL('/auth/v1/.well-known/jwks.json', supabaseUrl),
      })
    : config.supabaseJwtSecret === null
      ? new DenyAllAuthenticator(
          'neither SUPABASE_URL (JWKS) nor SUPABASE_JWT_SECRET is configured',
        )
      : new SupabaseAuthenticator({ jwtSecret: config.supabaseJwtSecret });

  const deviceTokenAuthenticator: DeviceTokenAuthenticator | null =
    config.deviceTokenSecret === null
      ? null
      : new DeviceTokenAuthenticator({ secret: config.deviceTokenSecret });

  const auth: AuthenticationPort =
    overrides.auth ??
    (deviceTokenAuthenticator === null
      ? supabaseAuthenticator
      : new CompositeAuthenticator([supabaseAuthenticator, deviceTokenAuthenticator]));

  /**
   * Which companions an account may act as.
   *
   * Postgres when there is one. Without a database the development binding is
   * used, which claims a companion for the first account that names it — see
   * `ClaimOnFirstUseBindings` for why that is a stopgap and not a policy.
   */
  const bindings: CompanionBindingStore =
    overrides.bindings ??
    (pool === null ? new ClaimOnFirstUseBindings() : new PgCompanionBindings(pool));

  /**
   * Account devices, durable in Postgres when there is one.
   *
   * Unlike bindings there is no development stand-in with different
   * behaviour: the in-memory store does exactly what the Postgres one does,
   * minus the durability. Registration has no policy to get wrong.
   */
  const devices: DeviceStore =
    overrides.devices ?? (pool === null ? new InMemoryDeviceStore() : new PgDeviceStore(pool));

  /**
   * Enrolments, durable in Postgres when there is one. Like devices there is
   * no development stand-in with different behaviour — an enrolment has no
   * policy to get wrong, only a row to write.
   */
  const enrolments: EnrolmentStore =
    overrides.enrolments ??
    (pool === null ? new InMemoryEnrolmentStore() : new PgEnrolmentStore(pool));

  /**
   * A headset's refresh-token families, durable in Postgres when there is
   * one. With no `NEXA_DEVICE_TOKEN_SECRET` this is `DenyAllDeviceTokenStore`
   * — see its own doc for why refusing is the safe failure mode, the same
   * reasoning `auth` above applies to a missing Supabase secret.
   */
  const deviceTokens: DeviceTokenStore =
    overrides.deviceTokens ??
    (config.deviceTokenSecret === null
      ? new DenyAllDeviceTokenStore()
      : pool === null
        ? new InMemoryDeviceTokenStore(
            devices instanceof InMemoryDeviceStore ? devices : new InMemoryDeviceStore(),
            config.deviceTokenSecret,
          )
        : new PgDeviceTokenStore(pool, config.deviceTokenSecret));

  /**
   * Pairing sessions, durable in Postgres when there is one. The
   * in-memory variant is constructed against the same
   * `InMemoryEnrolmentStore`, `InMemoryDeviceStore` and
   * `InMemoryDeviceTokenStore` instances above — not fresh ones — so all
   * four share rows exactly as the Postgres tables do. Redemption registers
   * the headset through the same `devices`, and mints its first token
   * family through the same `deviceTokens`, that a test's own assertions
   * and a later refresh call both read back from.
   *
   * With no `NEXA_DEVICE_TOKEN_SECRET` this is `DenyAllPairingSessionStore`
   * — redeem cannot safely issue a headset credential with no secret to
   * sign it, so pairing refuses outright rather than creating a session (or
   * a headset) that can never finish. Phone/Supabase authentication above is
   * unaffected either way: `auth` reads only `supabaseJwtSecret`.
   */
  const pairingSessions: PairingSessionStore =
    overrides.pairingSessions ??
    (config.deviceTokenSecret === null
      ? new DenyAllPairingSessionStore()
      : pool === null
        ? new InMemoryPairingSessionStore(
            enrolments instanceof InMemoryEnrolmentStore ? enrolments : new InMemoryEnrolmentStore(),
            devices instanceof InMemoryDeviceStore ? devices : new InMemoryDeviceStore(),
            deviceTokens instanceof InMemoryDeviceTokenStore
              ? deviceTokens
              : new InMemoryDeviceTokenStore(
                  devices instanceof InMemoryDeviceStore ? devices : new InMemoryDeviceStore(),
                  config.deviceTokenSecret,
                ),
            config.deviceTokenSecret,
          )
        : new PgPairingSessionStore(pool, config.deviceTokenSecret));

  /**
   * Onboarding, durable in Postgres when there is one. Unlike pairing state,
   * this has no "no secret configured" failure mode to guard — nothing about
   * it depends on `NEXA_DEVICE_TOKEN_SECRET`, and there is no unsafe
   * direction for it to fail in the way an unconfigured device-token store
   * has, so it composes exactly like `bindings`/`devices` do.
   */
  const profiles: ProfileStore =
    overrides.profiles ?? (pool === null ? new InMemoryProfileStore() : new PgProfileStore(pool));

  const selfModel = new SelfModel({
    clock,
    composed: composedFaculties,
    clientProvidable: clientProvidableFaculties,
    devices: (companionId) => embodiment.devicesOf(companionId as CompanionId),
    skills: (companionId) => embodiment.skillsOf(companionId as CompanionId),
  });

  const contextPorts: ContextPorts = {
    identity: new IdentityEngine(),
    expression: new PersonalityExpression(),
    personality: new InMemoryPersonality(),
    workingMemory,
    memoryRetrieval: new RetrievalEngine({
      memories,
      insights,
      relationships,
      workingMemory,
      scratchpad,
      embedder,
    }),
    relationship: new RelationshipRecord({ store: relationships, clock }),
    // Planning fills the advisor seam Core already had. It runs in the last
    // assembly wave, so its opinion is an input to a pure function rather than a
    // call made from inside one.
    decisionAdvisor: new PlanningAdvisor({ scratchpad }),
    goals: new NoGoals(),
    tools: new NoTools(),
    tokens: new HeuristicTokenEstimator(),
    embodiment,
    selfModel,
    // world, emotion and plan remain absent until their engines exist. Absent is
    // not degraded.
  };

  /**
   * Assembly budgets follow the stores.
   *
   * The defaults (400ms total, 150ms per port) are sized for a Map lookup.
   * Retrieval against a hosted database is four round trips before it has
   * anything to rank, so on those defaults it never finished: the section was
   * dropped, the turn reported `degraded`, and the companion answered as
   * though it remembered nothing — with the rows sitting in Postgres the
   * whole time. A budget is a deployment characteristic, exactly like
   * NEXA_PROVIDER_TIMEOUT_MS already is for the model.
   *
   * Raised only when a database is bound. In-memory deployments keep the
   * tight budgets, which is what makes a dropped section there a real signal.
   */
  const assemblerOptions =
    pool === null
      ? defaultAssemblerOptions
      : {
          ...defaultAssemblerOptions,
          assemblyBudgetMs: 6_000,
          portTimeoutMs: 2_500,
          advisorTimeoutMs: 3_000,
        };


  // ── admission ─────────────────────────────────────────────────────────────
  // In-process, which is correct for one API process. Both become distributed
  // implementations behind the same interfaces when the backend outgrows that.
  const gate: TurnGate = new InProcessTurnGate();
  const idempotency: IdempotencyStore<TurnResult> = new InMemoryIdempotencyStore(clock);

  // ── core ──────────────────────────────────────────────────────────────────
  const turn = new CognitiveTurn({
    perception: overrides.perception ?? new PerceptionEngine({ clock, scratchpad }),
    assembler: new ContextAssembler(contextPorts, clock, assemblerOptions),
    generator: new ActionGenerator({ model: languageModel }),
    workingMemory,
    memoryWrite,
    events,
    clock,
    gate,
    idempotency,
    observability,
  });

  // ── post-turn ─────────────────────────────────────────────────────────────
  // Reflection and relationship progression subscribe rather than being called.
  const consolidation = new Consolidation({
    events,
    clock,
    scratchpad,
    memories,
    insights,
    relationships,
    onError: (error) => {
      console.error('[nexa] consolidation failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    },
  });
  const stopConsolidation = consolidation.start();

  return {
    turn,
    events,
    clock,
    metrics,
    auth,
    bindings,
    devices,
    enrolments,
    pairingSessions,
    deviceTokens,
    profiles,
    modelName: languageModel.name,
    cognition: {
      scratchpad,
      workingMemory,
      memories,
      insights,
      relationships,
      formation: memoryWrite,
      consolidation,
      embodiment,
      selfModel,
    },

    async reportActionOutcome(
      companionId: CompanionId,
      userId: UserId,
      outcome: ActionOutcome,
    ): Promise<void> {
      await embodiment.report(companionId, outcome, outOfTurnOptions(clock));

      // Published after the write, so a subscriber that reads the body state
      // sees the outcome it was told about rather than the one before it.
      //
      // `actionExecuted` carries every outcome including failures — the event's
      // own documentation says `success: false` is normal rather than
      // exceptional — and `actionFailed` is emitted *additionally* for the ones
      // that went wrong, so a consumer interested only in failures does not
      // have to subscribe to everything and filter.
      // The body state itself is keyed on the companion alone — one companion
      // has one body, and two people talking to it are looking at the same
      // character. The *event* still carries a user, because what is learned
      // from a failed action ('moving to the kitchen keeps getting blocked')
      // is per-person knowledge and must stay inside the isolation boundary
      // everything else in this system respects. The client sends it for the
      // same reason it sends one on a turn: it knows who it is serving, and
      // the backend must not guess.
      const correlation: EventCorrelation = {
        companionId,
        userId,
        turnId: outcome.turnId,
        causedBy: null,
      };

      await events.publish(
        actionExecuted(correlation, {
          actionId: outcome.actionId,
          actionType: outcome.actionType,
          success: succeeded(outcome),
          clientId: companionId,
          durationMs: outcome.durationMs,
        }),
      );

      if (!succeeded(outcome)) {
        await events.publish(
          actionFailed(correlation, {
            actionId: outcome.actionId,
            actionType: outcome.actionType,
            clientId: companionId,
            reason: outcome.reason ?? 'unknown',
          }),
        );
      }
    },

    observeBody(companionId, observation): void {
      embodiment.observe(companionId, observation);
    },
    async shutdown(): Promise<void> {
      stopConsolidation();
      events.clear();
      // Released explicitly so a test that composes many applications does
      // not exhaust the database's connection limit.
      if (pool !== null) await pool.end();
    },
  };
};
