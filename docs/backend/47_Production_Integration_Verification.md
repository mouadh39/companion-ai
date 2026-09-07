# Production Integration Verification — 2026-09-06

What was verified against the **real `nexa-dev` Supabase project**
(`qjkcvyohaccbykrqymdr`, eu-central-1, Postgres 17) — not mocks — during the
production-integration pass. Run the backend locally with
`node --env-file=.env dist/index.js`; `.env` (gitignored) carries the real
`DATABASE_URL` and `SUPABASE_URL`.

## Database

- `0008_profiles.sql` is the **core** profile schema (`first_name`,
  `username`, `date_of_birth`, `completed_at`) — required, and **already
  applied** (migration `20260905011506`). It does **not** add "optional
  onboarding fields"; there are none in the approved design (the DesignSync
  screen map is Welcome → First Name → Username → Date of Birth → Completion,
  and the migration's own header says "exactly three things").
- All schema is live and RLS-enabled: `memories`, `insights`, `relationships`,
  `conversation_turns`, `companion_bindings`, `devices`, `pairing_sessions`,
  `device_tokens`, `device_enrolments`, `profiles`.
- Backend composed with real `DATABASE_URL` → `PgProfileStore`,
  `PgWorkingMemory`, `PgMemoryStore`, `PgPairingSessionStore` etc.
- **Durable across restart, verified:** a profile written, then read back by a
  fresh backend process (fresh pool) — unchanged. Same for memories /
  relationships / insights / conversation turns / embeddings
  (`persistence.test.ts`, `semantic.test.ts` against this DB — all green).

### Bug found and fixed in this pass

`PgProfileStore` read a `date` column back as a JS `Date` at the process's
**local** midnight; `.toISOString().slice(0,10)` then shifted the calendar day
on any non-UTC host (a `1998-05-04` DOB read back as `1998-05-03` on a UTC+2
machine — reproduced end-to-end). Fixed: every query now reads
`date_of_birth::text`, so Postgres's own calendar-date text is what crosses
the boundary. Regression test: `test/profile-persistence.test.ts` (runs only
with `DATABASE_URL`).

## Authentication

- `nexa-dev` signs access tokens **asymmetrically (ES256, JWKS)** — verified:
  the JWKS endpoint publishes one ES256 P-256 key, and a self-minted HS256
  token is **rejected** by the backend under `SUPABASE_URL` config (algorithm
  pinned). The legacy `SUPABASE_JWT_SECRET` in `.env` is valid (it verifies
  the project's anon key) but only exercises the offline HS256 path — a real
  Supabase sign-in never produces an HS256 token.
- **Production backend must run with `SUPABASE_URL`**, not the secret.
  `composition.ts` prefers the JWKS verifier when both are set. `.env` updated
  accordingly.
- `GET`/`PATCH /v1/profile` return **401** for missing / garbage / wrong-alg
  bearer tokens. The accept path (a well-formed ES256 token) is covered by
  `test/auth-jwks.test.ts` (8 tests, real ES256 tokens vs a local JWKS).

## Profile / onboarding — end-to-end against real Postgres

Driven over real HTTP with a token whose `sub` is the account:

| step | result |
|---|---|
| `GET /v1/profile`, new account | `{firstName:null, username:null, dateOfBirth:null, completed:false}` — not 404 |
| `PATCH {firstName}` → `GET` | first name persisted, others still null, `completed:false` |
| `PATCH {dateOfBirth:"2020-01-01"}` | **400** "You need to be at least 13 to use Nexa." |
| `PATCH {username:"1bad"}` | **400** username shape |
| `PATCH {username}`, then `PATCH {dateOfBirth}` (valid) | `completed` flips to **true** only when all three set |
| DOB round-trip | exact calendar date, no timezone shift (post-fix) |
| second account `PATCH` same username, different case | **409** `username_taken` |
| resume: re-send only `{firstName}` | username + DOB **preserved** |

`completed_at`, once set, is never cleared by a later edit (verified in
`PgProfileStore`).

## Device pairing — as far as possible without Quest hardware

`test/pairing-sessions.test.ts` adds a `describeIfDb` block that runs the full
redemption flow against **real Postgres** with **real P-256 signatures**:

- enrol a real key (`POST /v1/device-enrolments`) → create a session as the
  phone (`POST /v1/pairing-sessions`) → status `pending`
- headset redeems with a genuine `crypto.sign` P-256 signature over the real
  `buildChallenge` (`POST /v1/pairing-sessions/redeem`) → `200`, `paired:true`,
  a device access token on the `nexa-device` audience whose `sub` is the account
- status now `redeemed`, with the headset's device id; the headset is a real
  `devices` row (`kind='headset'`) on the account
- **a consumed handle cannot be redeemed twice** — DB-enforced (partial unique
  index)

The UDP discovery hop (headset broadcast → phone `LocalTransportPairingLink`)
is covered on real loopback by `lan_discovery_socket_test` /
`local_transport_link_test`; the phone's poll-to-`paired` by
`real_tqrcg_service_test`. **Flutter production composition uses the real
transport** — `RealTqrcgService` + `LocalTransportPairingLink`, never the
scripted stand-ins (`pairing_composition_test.dart`).

**Not verified — needs hardware:** a real Quest doing the camera scan +
on-device key storage; on-device LAN pairing; the iOS
`com.apple.developer.networking.multicast` entitlement for UDP-broadcast
discovery (needs an Apple approval against the real bundle id).

## Test results

| suite | result |
|---|---|
| backend `npm run build` / `lint` | clean |
| backend `npx vitest run` (no DB) | 337 pass, 18 skipped (DB suites) |
| backend `npx vitest run` **with `DATABASE_URL`** | **355 pass, 0 skipped** |
| `flutter analyze` | clean |
| `flutter test` | **290 pass** |
| `flutter build apk --debug` | success |
| `flutter build web --release` | success |

## Still externally blocked

- A **confirmed Supabase account** for the last hop (real browser sign-in →
  real ES256 token → `/v1/profile`). Test accounts
  `rezguimouadh2020+nexaqa{1,2}@gmail.com` exist but are **unconfirmed** —
  `auth.users` reads/writes are blocked in this environment, and
  `mailer_autoconfirm` is off. Click the confirmation email, or delete the
  accounts.
- `NEXA_DEVICE_TOKEN_SECRET` — a backend-owned HMAC key the deployment must
  choose; absent it, pairing redemption/refresh is `DenyAll`. `.env` has a
  placeholder line with a generator command.
- A **deployed** backend + `NEXA_BACKEND_URL` in the Flutter build.
- OAuth provider credentials (all providers `false` on `nexa-dev`).
- Apple multicast entitlement; Quest / Bluetooth hardware.
