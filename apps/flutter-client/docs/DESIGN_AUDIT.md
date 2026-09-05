# Nexa Mobile — Design Fidelity & Functionality Audit

Authoritative source: Claude Design project `7765ed00-65c5-44c3-83b2-1c5cf7d4d52c`
("Nexa Mobile Redesign"), read via DesignSync on 2026-09-06.

- `Nexa Mobile Redesign.dc.html` — the review harness (theme toggle, screen nav, notes).
- `NexaPhone.dc.html` — the actual UI component: every screen, both themes, all motion.
- `uploads/Nexa_Mobile_App_Design_Handoff/**` — design system, screen map, UX rules,
  component list, QA workflow.
- `screenshots/**` — rendered reference frames (01–09 per area, light+dark).

Compared against `apps/flutter-client` working tree on branch
`chore/phase-1.5-and-monorepo-foundation` (which already carries ~1,900 lines of
in-flight UI work).

**Headline finding.** The Flutter client is already a high-fidelity implementation of
this exact design language — it was built from an earlier ("Stage 1") cut of the same
system. The authoritative `.dc.html` is a *representative pass* covering five core
screens + entrance + auth + onboarding, explicitly "held for review… nothing
propagates to the remaining screens until you approve the language here." So this is a
**reconciliation pass**, not a port from zero. The deltas are real but bounded.

---

## 0. Authoritative design system (from `NexaPhone.dc.html`)

### Tokens — exact values the reference uses

| token | DARK | LIGHT |
|---|---|---|
| `--void` | `#040507` | `#EDF2EE` |
| `--ground-top` | `#0A0E12` | `#FAFCFA` |
| `--ink` | `#F3F7F4` | `#0E1211` |
| `--ink86/72/55/50/45/42/36/34/32/30` | white @ .86….30 | `#0E1211` @ .86….42 (note: 55→.58, 45→.52, 42→.50, 36→.46, 34→.46, 32→.44, 30→.42) |
| `--emerald` | `#4ADE9B` | `#12805A` |
| `--emerald-bright` | `#7FF0BE` | `#0B6242` |
| `--emerald-wash` | `rgba(74,222,155,.12)` | `rgba(18,128,90,.09)` |
| `--emerald-border` | `rgba(74,222,155,.35)` | `rgba(18,128,90,.30)` |
| `--hairline` | white .07 | black .08 |
| `--hairline-strong` | white .10 | black .10 |
| `--glass-border` | white .14 | black .10 |
| `--glass-tint` | white .08 | white **.72** |
| `--group` | white .045 | white **.86** |
| `--surface-quiet` | white .045 | ink .045 |
| `--surface-lift` | white .08 | black .06 |
| `--chrome` | `rgba(16,20,24,.72)` | white .86 |
| `--ink-button` | `#EDF2EE` | `#14181B` |
| `--on-ink` | `#06070A` | `#F7FAF8` |
| `--danger` | `#F0A08A` | `#B0402A` |
| `--danger-border` | `rgba(240,160,138,.24)` | `rgba(176,64,42,.26)` |
| `--danger-wash` | `rgba(240,160,138,.10)` | `rgba(176,64,42,.07)` |
| `--shadow` | `0 24px 60px rgba(0,0,0,.55)` | `0 16px 40px rgba(0,0,0,.10)` |
| `--frost-edge` | `inset 0 1px 0 rgba(255,255,255,.14)` | `inset 0 1px 0 rgba(255,255,255,.85)` |
| `--halo` | `rgba(74,222,155,.16)` | `rgba(18,128,90,.09)` |
| `--plinth` | `rgba(74,222,155,.10)` | `rgba(18,128,90,.09)` |
| `--contact` | `rgba(0,0,0,.55)` | `rgba(14,18,17,.16)` |
| `--bloom-a / -b` | emerald .10 / .06 | emerald .16 / .11 |

Font: **Manrope** 300/400/500/600 (the reference; the Flutter app keeps the platform
sans as a Satoshi stand-in — same metrics class, acceptable, documented in pubspec).

Type scale (reference): screen title 28/600/-.03em; assistant presence line 23/600/-.03em;
big display 24–29/600; body 14–14.5/1.45–1.6; row label 14.5; section kicker
10/500/.24em uppercase; field label 10.5/500/.18em uppercase.

Radii: phone frame 44; glass panels/cards 20–22; grouped list 18; sheet/empty-state 28;
pills 999; fields 14; icon circles 50%.

Motion curves: `cubic-bezier(.2,.8,.2,1)` (UI), `cubic-bezier(.32,.72,0,1)` (screen fade),
`cubic-bezier(.22,.61,.16,1)` (entrance/step). Keyframes: `nx-breathe` 7s (scale 1→1.028,
-6px), `nx-breathe-fast` 1.6–2.2s, `nx-halo` 9s, `nx-ring` 2.4s ×3 staggered .8s,
press `scale(.975)` 100ms.

### Components the reference actually renders

Assistant, Devices (empty + catalogue), Memory (empty + loading skeleton), Account,
Settings, Entrance (3 variants), Onboarding (5 steps + greeting), Auth (signin/signup/forgot
with idle/validation/busy/outcome variants), floating tab bar.

### UX rules that constrain implementation (`Nexa_UX_Rules.md`)

1 primary action per screen · reduce noise · current state obvious · progressive disclosure ·
short human copy · **never fabricate memories/devices/conversations/names/statistics** ·
honest empty states · errors explain + one recovery action · pairing feels secure without
exposing internals · voice central not forced · not a social feed · no decorative orb
substituting for function · logo is a brand mark not decoration · system scales to XR.

---

## 1. Screen-by-screen delta

### 1.1 Entrance / Welcome  — **largest gap**

| aspect | reference | current Flutter | delta |
|---|---|---|---|
| concept | timed cinematic entrance: mark arrives as a physical object (opacity 0→1, scale .88→1, +16px rise on `nx-arrive`), then slow 3D orientation drift (`nx-orient` ±2.4° / ±7°rotateY), **one emerald light pass masked to the mark silhouette** (`nx-sweep`, `mask-image: mark-emerald.png`), restrained breathing bloom, hold, then `nx-exit` scale-down + hand-off | `WelcomeScreen`: a **static** screen — wordmark, breathing mark, headline "Explore what's next.", "Get started" / "I already have an account" buttons | **Missing entirely.** No pre-auth entrance. `WelcomeScreen` is a normal welcome/CTA screen. |
| timing | first launch ~2.78s → routes to sign-in (unauth) or `routeAfterAuthentication` (auth); returning fully-onboarded ~0.99s, no light pass; reduced-motion ~0.8s plain fade | n/a | build new `EntranceScreen`; wire into `main.dart` startup before the first real screen |
| routing decision | unauthenticated → sign in; authenticated → `routeAfterAuthentication` (assistant vs onboarding vs error) | today the app boots straight to `NexaScreen.welcome`, and a restored session runs `routeAfterAuthentication` in `initState` | keep routing logic; front it with the entrance |
| asset | `mark-emerald.png`, drop-shadow bloom `0 0 64px rgba(74,222,155,.42)` (dark) / `0 0 40px …,.2) saturate(1.18)` (light) | `NexaMark` already does tinted-silhouette bloom | reuse `NexaMark` + add sweep + orient |
| **preserve** | — | `_NexaAppState.initState` restore sequence (session → route → phone device); reduced-motion via `NexaAppearance` | do not change the restore/route sequence, only defer the first visible screen |

Note: the reference `WelcomeScreen`-equivalent (mark + "Nexa / A more present you." + "Get
started") from the design *board* PNG is folded into the entrance→auth flow in the newer
`.dc.html`; the interactive reference goes entrance → **sign in** directly. Decision for
the port: keep a minimal Welcome (mark + one line + Get started / I have an account) as the
unauth landing *after* the entrance, since the app needs a sign-up entry point the bare
sign-in screen doesn't give; the entrance is the new part.

### 1.2 Sign In / Sign Up / Forgot password

| aspect | reference | current Flutter | delta |
|---|---|---|---|
| provider buttons | Google, Apple, Meta, **passkey** — as **monochrome silhouette rows** on `--glass-tint` + `--glass-border` + `--frost-edge`, blur 14, `stroke: var(--ink72)`. NOTE says: "none is wired to a real provider in the current build; they need real OAuth/WebAuthn before ship" | 3 provider `NexaPillRow`s with tiny `#1F1F1F` glyph tiles (Google/Meta custom painters); tapping any provider calls `advance()` → **navigates to assistant/meeting (fake success)** | **1. Provider tap must not fake success.** Show an honest inline notice ("Google sign-in isn't connected yet — use email below"). 2. Style as monochrome silhouette rows, not colored-glyph tiles. 3. Add passkey as a 4th provider row (honest, same treatment). |
| phone mode | not present | `AuthMode.phone` sub-mode with `+1 / (555)…` field, "Send code" → `advance()` (fake) | **Remove phone from the V1 auth UI** (handoff: "Phone… NOT part of the approved V1"). Keep `AuthMode` enum value or drop — see §3. |
| email form | `Email` + `Password` (+ `Confirm password` on sign-up), boxed fields (`background var(--surface-quiet)`, `border var(--hairline-strong)`, radius 14, 16px text), focus ring `0 0 0 3px var(--emerald-wash)`, Show/Hide toggle, inline field errors, form-error banner with icon on `--danger-wash` | `_EmailBody` — **real** `AuthSessionRepository.signInWithPassword`/`signUp`, `NexaField` (underlined, not boxed), bare "Show"/"Hide", inline errors, confirm-email notice | **Field style differs**: reference is boxed with focus ring; current is the underlined `NexaField`. Reference titles: "Welcome back." / "Welcome to Nexa" / "Reset your access." (current matches). Reference sign-up subtitle "Create your account with an email and a password." Real auth logic is correct — **keep**. |
| layout | mark(34) + wordmark(12, .8 opacity) top-left, then title 29/600, subtitle 14.5, then providers, then `or use email` divider, then form; footer switch link centered with emerald action word; "Forgot password?" under the sign-in button | matches closely; wordmark is text (`NexaWordmark`) not image | minor: use wordmark PNG; divider label "or use email" vs current "OR" |
| busy state | button shows a spinner (`nx-spin` .8s) + "Signing in…" etc, opacity .66 | button label swaps to "Signing in…", no spinner | add spinner to `NexaPrimaryButton` busy state (optional) |
| notices | sign-up outcome → emerald-wash card "We've sent a confirmation link to your email." / forgot outcome → "Check your email for the reset link." | `_ConfirmEmailNotice` (sign-up) and `_ForgotBody` sent-state exist and are real | copy alignment only |
| **preserve** | — | **all of `AuthSessionRepository` + `SupabaseAuthClient` + `authErrorMessage` + `_EmailBody`/`_ForgotBody` real network logic + `routeAfterAuthentication` call** | do not touch auth logic, only presentation + provider honesty |

### 1.3 Post-auth onboarding (`meeting_screen.dart`)

| aspect | reference | current Flutter | delta |
|---|---|---|---|
| steps | 5: **name → date of birth → username → optional profile (photo, interests chips, language) → Nexa personality (3 segmented traits)** + a separate ~1.5s greeting hand-off ("Nice to meet you, {name}." / "Let's get started.") | 5 beats: welcome → **first name → username → date of birth** → all-set | **Order differs** (ref: name, DOB, username; current: name, username, DOB). **Ref adds two optional steps** (profile, personality) that the current flow doesn't have. Current "all-set" beat ≈ ref greeting but rendered as a normal beat with a Continue button, not a timed hand-off. |
| welcome beat | ref has no standalone welcome beat in `.dc.html` onboarding (entrance covers arrival); first step is "What should Nexa call you?" | `_beatWelcome`: "Hey. I'm Nexa." + body + "Let's get started" | ref folds this into the entrance; current keeps it. Low-risk to keep. |
| DOB input | native `<input type="date">`; under-13 → respectful red card "Nexa is available to people aged 13 and over." + "Come back when you're old enough" | 3 numeric fields DD / MM / YYYY; under-13 → "You need to be at least 13 to use Nexa." | keep 3-field (native date picker on Flutter is a modal; 3-field matches the app's field idiom). Copy: soften to the respectful two-line message. |
| username | on-device shape check (`^[a-z0-9_.]{3,20}$` in ref, `^[A-Za-z][A-Za-z0-9_]{2,19}$` in current + backend); note copy: "Nexa checks this is free when you continue — usernames are unique across every account." **No fake availability tick.** | current: shape check on device, uniqueness enforced by backend `PATCH /v1/profile` (409 → "That username is already taken."). Note copy differs. | copy alignment; current behaviour is correct and real |
| progress | 5 dots, active dot widens to 18px | 5-segment progress bar | either is fine; keep bar or switch to dots |
| optional steps persistence | ref NOTE: "Photo storage is not connected, so the UI exists and skips cleanly instead of pretending to upload." Personality: "The defaults are already good. Change these any time in Settings." | not implemented | **DECISION (see §4):** the `profiles` table is deliberately 3 fields. Adding interests/language/personality persistence requires new nullable columns + a backend contract change. Do NOT ship non-persisting toggles ("switches that do nothing" — UX rule). Options: (a) add real columns + wire, (b) defer the optional steps and document. Recommend (b) for this pass unless backend can be extended safely. |
| **preserve** | — | **`ProfileRepository.updateMine` per-step backend calls, `_startingBeatFor` resume logic, age validation, username pattern, `onboardingProfile` seeding** — this flow is genuinely real and resumable | do not replace with local state; keep every backend call |

### 1.4 Assistant

| aspect | reference | current Flutter | delta |
|---|---|---|---|
| composition | greeting kicker (`{Hello / Listening / Nexa}` 10/.22em) + presence line (23/600: "Nexa is here" / "Go ahead" / "Speaking") top-left; account glyph button top-right; mark centered (162 idle / 176 listening / 184 speaking, glow 54/78/86); listening → 3 staggered `nx-ring`s; live chip under mark ("YOU"/"NEXA" on emerald-wash pill w/ glowing dot) OR "Tap to speak" when idle; bottom row = "Memories" glass card + 62px emerald mic (dot → 4px rounded square when live) | `AssistantScreen` — **matches almost exactly**: same greeting/presence lines, `_RoundIconButton('⋯')`, `NexaMark` 162/176/184 glow 54/78/86, `NexaListeningRing`, live label "YOU"/"NEXA", "Memories" `NexaGlassCard` + `_MicButton` 62px with dot→square | **very close.** Deltas: (1) ref idle shows "TAP TO SPEAK" under the mark; current shows nothing when idle. (2) ref live chip is a bordered emerald-wash **pill with a glowing dot**; current is a bare emerald label. (3) ref account button is a person-outline SVG; current is "⋯" glyph. (4) ref greeting is "Hello" not "Hello, {first}" when a name exists — actually current personalises, which is arguably better and not fake. |
| conversation | **no chat log, no transcript, no waveform** — mark size/bloom/tempo is the entire interface | same — `talk()` runs a scripted idle→listening→speaking→idle timer with **no fake transcript** | matches. `talk()` timing is local placeholder for the real turn pipeline — **preserve the seam**, it's honest (no invented responses). |
| **preserve** | — | `state.talk()` state machine, presence screen routing, no-transcript design | keep |

### 1.5 Devices

| aspect | reference | current Flutter | delta |
|---|---|---|---|
| default state | **empty is the default** — "No devices yet." + 118px dormant mark (`mark-graphite` dark / `mark-stealth-black` light, opacity .55, breathing) + "Connect Nexa to the things around you…" + "Add your first device" pill + footnote "Your phone is Nexa's gateway…" | `_NoDevicesYet` — mark 118 (emerald, not dormant), "No devices yet.", same copy, "Add your first device" | (1) empty-state mark should be the **dormant** material (graphite/stealth-black) at opacity .55, not emerald. (2) ref puts an "Add device" row **above** the empty card always; current shows the add button then the empty card — equivalent. (3) footnote wording matches. |
| catalogue | 2-col grid of product cards on a lit plinth (`--plinth` radial + `--contact` blurred contact shadow), name + "Not paired" dot-row; header "Available to pair · N devices"; footnote "Nothing is paired to this account yet. Pairing takes about a minute per device." | separate `ConnectScreen` (`NexaScreen.connect`) — needs its own audit; `DevicesScreen` catalogue not inline | ref shows catalogue inline as a variant of the Devices screen; current routes to a dedicated Connect screen. Both valid; current has more room. Product-card **plinth + contact shadow** treatment should be checked against `DeviceVisual`. |
| my devices | product card (image top half, name + kind + status line), emerald border when connected | `MyDeviceCard` — matches (image 158h, name 17/500, kind, `DeviceStatusLine`, emerald/hairline border) | close match |
| **preserve** | — | `DeviceRepository` (catalogue is **real reference content**, `mine()` starts empty, `markPaired`/`forget` process-local until backend), the whole pairing flow (`connect`→`pairIntro`→`pairing`→`pairingCode`→`success`) | do not touch pairing; see §2 |

### 1.6 Memory

| aspect | reference | current Flutter | delta |
|---|---|---|---|
| default state | **empty is the default** — 96px dormant mark (.55, breathing) + "Nexa hasn't remembered anything yet." + "Nexa will remember what matters as you start talking." + "Talk to Nexa" emerald-wash pill | `MemoryEmptyView` — mark 96 **graphite**, same headline, same body, `NexaEmeraldButton` "Talk to Nexa" | (1) ref light-mode dormant mark is `mark-stealth-black`; current always `graphite`. (2) otherwise matches. |
| loading | shimmer skeleton: 132px bar, 3 pill bars, 3×96px bars, `nx-shimmer` 1.6s | `_MemorySkeleton` — 132 bar, 3 pills (84/92/78), 4×96 bars; no shimmer animation | add `nx-shimmer` opacity pulse to the skeleton (currently static) |
| list (when populated) | not shown in `.dc.html` (empty/loading only) | `_Overview` emerald card + `_Filters` chips + `_MemoryCard`s + "Memory controls" | current list design is from the earlier system; no authoritative reference to conflict with — keep |
| **preserve** | — | `LocalMemoryRepository` **starts empty**, `forget`/`forgetAll` real (process-local), no seeded entries | keep — this is exactly the "honest empty state" the UX rules demand |

### 1.7 Account ("You")

| aspect | reference | current Flutter | delta |
|---|---|---|---|
| header | avatar circle (glass, "N" monogram when no photo) + "Your account" + **"Set up your profile" emerald pill** (routes to onboarding `NexaScreen.meeting`) when no profile saved | `ProfileScreen` — glass avatar (first initial or "N"), `state.displayName` ("Your account" when empty), `state.email` line | **Missing "Set up your profile" affordance.** Ref: with no profile, the identity block offers setup rather than showing a name. Current shows `displayName` = "Your account" + email but **no CTA into onboarding**. Add the pill. |
| relationship card | emerald-wash "You and Nexa" card: "Nexa is just getting to know you." + **real zeroes** "0 memories / 0 devices" | `_Stat` row "N memories / N devices" on emerald-wash card, "Nexa is just getting to know you." | matches (real counts). |
| groups | **Nexa**: Voice (→Settings), Appearance, Memory "0 kept", Devices "0 paired". **Account**: Profile "Not set up", Notifications, Privacy, Security. Then: Settings, About Nexa. Then **"Log out"** danger-outline pill | `ProfileScreen` groups: **Nexa** (Voice/Appearance/Memory/Devices) · **Account** (Profile/Notifications/Privacy/Security) · (Settings/About) · "Log out" danger outline | **matches structure closely.** Delta: ref Profile row value is "Not set up" when empty (current shows `displayName`). Ref rows carry a leading icon-in-circle; current `NexaRow` supports icons but `ProfileScreen` passes none → icons missing on this screen. |
| **preserve** | — | `state.logOut()` → `authSession.logout()` + `phoneDevice.clearActiveDevice()`; real counts from repos | keep logout logic exactly |

### 1.8 Settings

| aspect | reference | current Flutter | delta |
|---|---|---|---|
| top | back chevron → Account; "Settings" 28/600 + "Everything about your Nexa."; **Appearance promoted to top as a live segmented control** (System / Light / Dark) on a solid `--group` card + a one-line note per mode | `SettingsScreen` (needs full read) — appearance is a sub-screen `NexaScreen.settingsAppearance` | ref **inlines** the System/Light/Dark segmented control at the top of Settings with live note; current has it one level down. Promote it. |
| groups | Experience (Voice, "Wake with Hey Nexa" toggle, Subtitles toggle) · What Nexa keeps (Memory "0 kept", "Store voice recordings" toggle — "Off by default") · Paired devices "0" · footer wordmark (.34 opacity) + "Personal AI · Spatial computing" | grouped `NexaGroup`/`NexaRow`/`NexaToggleRow` tree across many sub-screens | ref is flatter — most settings on one Settings screen with sub-screens only where needed. Current has a deeper tree (`settingsNexa`, `settingsVoice`, `settingsMemory`, `settingsNotifications`, `privacy`, `security`, `about`). Reconcile toward the flatter shape OR keep the tree and just promote Appearance + add the footer wordmark. |
| toggles | emerald-wash track + glowing emerald knob when on; `--surface-lift` + ink knob when off | `NexaSwitch` — emerald-wash track + glowing emerald knob / surfaceLift + ink50 knob | **matches.** |
| **preserve** | — | `PreferencesRepository` (`theme`, `reducedMotion`, `voiceId`, `appearanceId`, toggles) — every switch is backed by a real preference | keep; do NOT add toggles that persist nothing |

---

## 2. Device pairing — audit only, DO NOT MODIFY

The pairing/crypto architecture is complete, thoroughly documented, and explicitly
out of scope for a visual redesign ("Do NOT rewrite… device pairing, security, token
handling"). State of the real system:

| layer | file | state |
|---|---|---|
| DB schema | `supabase/migrations/0005–0007` | applied to `nexa-dev`; `devices`, `pairing_sessions`, `device_tokens`, `device_enrolments`, `device_token_families`; RLS on, no policies (backend-owner access) |
| headset identity | `Unity/Nexa/Assets/_Project/Identity/P256Curve.cs` + `InMemoryHeadsetIdentity` | from-scratch verified P-256 (commit `55c98f4`); private key never leaves device |
| backend routes | `apps/backend/src/server.ts` | `POST /v1/device-enrolments`, `POST /v1/pairing-sessions`, `GET …/status`, `POST …/redeem`, `POST /v1/devices/token/refresh` — all implemented, single-use code hash, bound-to-headset-key, atomic redemption via partial unique index |
| Unity redemption client | commit `fecf127` | implemented |
| Flutter side | `NexaBackend`, `PairingSessionRepository`, `RealTqrcgService`, `DeviceLinkService`, `LanDiscoverySocket`, `LocalTransportLink` | typed clients + LAN transport; `RealTqrcgService` reports `paired` only when the **backend** reports `redeemed` (authoritative completion — `real_tqrcg_service_test.dart`) |
| security properties tested | `pairing_*_test.dart` (backend + flutter) | expired QR fails, already-redeemed fails, wrong-headset fails, invalid signature fails, cancelled fails |

**Gaps (documented, not bugs to fix tonight):**
- No Bluetooth transport yet — LAN discovery only (`DeviceLinkService` doc says so).
- `LocalTqrcgService` / `LocalDeviceLinkService` are still the default wiring in
  `NexaAppState` (real variants exist but aren't composed by default). Switching the
  default to the real services requires a running backend (see §3) — **blocked on the
  backend JWT secret**, not on code.
- The pairing UI (`connect`/`pairIntro`/`pairing`/`pairingCode`/`success`) has no
  authoritative `.dc.html` reference — it's from the earlier system. Screenshots 25–35
  exist. Leave as-is pending a design reference for it.
- Physical Quest pairing has never been run on hardware (see `MEMORY.md`:
  "Quest passthrough unverified"). Cannot be claimed as verified.

---

## 3. Backend / database / auth — real vs blocked

Live Supabase project `nexa-dev` (`qjkcvyohaccbykrqymdr`), accessible via the Supabase
MCP. Migrations applied: `memory_persistence`, `enable_rls`, `pgvector`, `profiles`.
`auth.users` has 1 row (a prior test account).

| capability | mechanism | status tonight |
|---|---|---|
| **Email/password auth** | Flutter → Supabase Auth REST directly (`SupabaseAuthClient`), needs only project URL + **anon key** (publishable, safe to ship in the client) | **UNBLOCKED.** Anon key retrieved via MCP. Wiring a committed `dart_define` config makes sign-up / sign-in / sign-out / session-restore / forgot-password genuinely work. |
| Session persistence | `SessionStore` (flutter_secure_storage) + `AuthSessionRepository.restore/validAccessToken` (lazy refresh, rotation) | real, already implemented, testable once auth is configured |
| **Profile persistence** (onboarding, username uniqueness, DOB) | Flutter → `NexaBackend` → `apps/backend` `PATCH /v1/profile` → `profiles` table. Backend verifies the Supabase access token with **`SUPABASE_JWT_SECRET` (HS256 shared secret)** | **BLOCKED.** The JWT secret is not in the repo, not exposed by the Supabase MCP, and cannot be derived. Without it the backend denies every request (`deny-all` verifier). Also needs `DATABASE_URL` (DB password) for durable storage, or runs in-memory. **This is a genuine external-credential blocker.** |
| Device state from backend | same path (`GET /v1/devices` — note: not yet implemented; `POST /v1/devices` exists) | BLOCKED (same reason) + endpoint gap |
| Memory from backend | `apps/backend` postgres memory stores (`0001/0003`) | BLOCKED (same reason) |
| OAuth (Google/Apple/Meta) | Supabase Auth providers | **BLOCKED** — no provider client IDs / secrets / redirect URIs configured. Cannot fake. |
| Model/turn pipeline | `apps/backend` + `@nexa/core` + a provider key (Groq/Anthropic) | out of scope; no fake conversations |

**What "real" looks like after this pass:** email auth end-to-end against live Supabase;
everything backend-mediated (profile, devices, memory) stays wired to the real client
code but returns `BackendNotConfiguredException` / `AuthNotConfiguredException` honestly
until the backend is deployed with its secrets. The UI already handles those states
(`NexaScreen.error`, onboarding error text) — no fake success anywhere.

---

## 4. Decisions taken for the implementation pass (no user available)

1. **Tokens** → reconcile `nexa_colors.dart` LIGHT/DARK to the authoritative maps
   verbatim (§0). Low risk, high fidelity gain.
2. **Entrance** → build `EntranceScreen` per the authoritative motion + timing +
   routing; front it in `main.dart`. Respect reduced motion. Keep a slim Welcome after
   it as the unauth sign-up entry point.
3. **Auth providers** → render Google/Apple/Meta/passkey as monochrome silhouette rows;
   tapping shows an honest "not connected yet — use email" inline notice. **No fake
   navigation.** Remove the phone sub-mode from the UI. Keep `AuthMode.email`/`providers`;
   drop `phone`/`passkey` sub-modes (passkey becomes a provider row, not a mode).
4. **Onboarding optional steps** → **defer** the profile-photo / interests / language /
   personality steps for this pass. Rationale: the `profiles` table is deliberately
   3-field, the backend contract has no columns for them, and shipping toggles that
   persist nothing violates the "no switches that do nothing" UX rule. Keep the real
   3-field flow; align copy; add the timed greeting hand-off. Documented for a
   follow-up that extends the schema + `PATCH /v1/profile` deliberately.
5. **Empty-state marks** → use the dormant material (`graphite` dark / `stealth-black`
   light) at opacity .55 on Memory + Devices empty states, per reference.
6. **Account** → add the "Set up your profile" pill into onboarding when no profile;
   Profile row value "Not set up" when empty.
7. **Settings** → promote the System/Light/Dark segmented control to the top of the
   Settings screen with the live note; add the footer wordmark + tagline. Keep the
   existing sub-screen tree (removing it is scope creep with no reference demand).
8. **Branding** → rename to "NEXA AI", applicationId `ai.nexa.app`, iOS bundle name
   "Nexa"; generate launcher icons from `mark-*.png` via `flutter_launcher_icons`.
   Dynamic (theme-reactive) **launcher** icons: Android supports it only via
   `activity-alias` swaps (janky, app restarts); iOS supports `setAlternateIconName`.
   In-app branding is fully theme-reactive already. Recommend: ship one correct
   adaptive launcher icon + document the platform limitation rather than a fragile
   alias swap.
9. **Wordmark** → import `wordmark-ink.png` / `wordmark-white.png`; `NexaWordmark`
   renders the theme-appropriate PNG with the text version as fallback.
10. **Pairing** → no code changes. Audit only (§2).

---

## 5. What must NOT be changed (preservation list)

- `AuthSessionRepository`, `SupabaseAuthClient`, `SessionStore`, `authErrorMessage`,
  `routeAfterAuthentication` — real auth, session, routing.
- `ProfileRepository`, `NexaBackend`, `NexaApiClient` — real backend clients + the
  per-step onboarding calls in `meeting_screen.dart`.
- `PhoneDeviceRepository`, `PairingSessionRepository`, `RealTqrcgService`,
  `DeviceLinkService`, `LanDiscoverySocket`, `LocalTransportLink`, `P256Curve`,
  all `devices/` backend code, all `supabase/migrations/*`.
- `NexaAppState` navigation/state model, `_NexaAppState.initState` restore sequence.
- `LocalMemoryRepository` (empty by design), `LocalDeviceRepository` catalogue
  (real reference content, `mine()` empty by default).
- `PreferencesRepository` and every preference it persists.
- The no-transcript Assistant design and the `talk()` placeholder seam.
- All 263 passing tests and the QA screenshot process (`docs/qa/`).
