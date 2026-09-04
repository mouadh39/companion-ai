# Nexa — Flutter client

The phone app. In the product it is the gateway: account, Nexa, memory and
devices. Every other surface Nexa lives on is paired from here.

Built from the `Nexa Foundation Stage One` design bundle (Claude Design). The
design medium was HTML/CSS prototypes; this is the real implementation, and
the numbers in `lib/theme/` are lifted from those files rather than
re-derived, so a value that looks arbitrary usually is not.

## What is here

This is the first pass: the token layer plus one flow end to end.

| Screen | File | State |
|---|---|---|
| Welcome | `screens/welcome_screen.dart` | Built |
| Sign up / Log in / Forgot | `screens/auth_screen.dart` | Built — four modes on one surface |
| First meeting | `screens/meeting_screen.dart` | Built — three beats |
| Assistant (idle / listening / speaking) | `screens/assistant_screen.dart` | Built |
| Memory, Devices, Pairing, Profile, Settings, Voice, Empty, Error | — | Not yet |

`NexaScreen` in `lib/app_state.dart` lists all 25 screens the design specifies,
so the unbuilt ones already have identities and the navigation model does not
have to change as they land. Anything unbuilt renders a deliberate placeholder
rather than a blank surface, and its tab is inert.

## Running it

```bash
cd apps/flutter-client
flutter run -d chrome     # web — no toolchain needed
flutter run               # a connected phone or emulator
flutter test              # the flow tests
```

On a window wider than a phone the app draws itself at 390×844 inside a device
frame, the way the design presents it, instead of stretching. On a phone the
frame is not drawn at all.

Windows desktop is configured but needs a Visual Studio C++ toolchain, which
is not installed on the machine this was built on.

## The design system

`lib/theme/` is the whole of Stage 1, and it is the part to read first.

- **`nexa_colors.dart`** — two families and nothing else. Near-black
  environments (`#040507` → `#1D2127`) and one emerald light source
  (`#0B3A28` → `#A7F3D0`). Text is white at named opacities, because that is
  how the design specifies it.
- **`nexa_typography.dart`** — four roles: brandmark, display, body, label.
  Every piece of text on a Nexa surface is one of them.
- **`nexa_theme.dart`** — the 4/8/12/20/32/56 spacing scale, the five radii,
  the one shadow, and the motion constants.

### Satoshi

The brand face is Satoshi, from Fontshare. Its licence is not ours to vendor,
so the files are not in the repo and the app currently renders in the platform
sans. The metrics are close enough that the layout holds, but it is not the
design until the real face is in.

To fix: drop the four weights into `assets/fonts/`, uncomment the `fonts:`
block in `pubspec.yaml`, and set `NexaType.fontFamily` to `'Satoshi'`.

## The idea worth not breaking

The mark is the interface. There is no chat log and no waveform anywhere in
this app — Nexa's state is carried entirely by the mark's size, bloom and
breathing tempo:

| State | Size | Bloom | Tempo |
|---|---|---|---|
| Idle | 162 | 54 | 7s |
| Listening | 176 | 78 | 2.2s — plus an expanding ring |
| Speaking | 184 | 86 | 1.6s |

`NexaMark` renders the bloom as a blurred, tinted copy of the artwork's own
silhouette rather than a box shadow, so it follows the alpha the way the
prototype's CSS `drop-shadow` does.

## What is faked

`NexaAppState.talk()` scripts a turn on timers — listen 2.6s, speak 5.2s, then
settle. There is no backend attached. When `@nexa/core` drives this, the same
three states come from the turn pipeline and the timers go away; nothing else
about the screen should need to change.

The transcript copy on the assistant screen is the prototype's sample text.

## Not a workspace member

`pnpm-workspace.yaml` covers `packages/*` and `apps/backend` only. This app is
managed by `flutter`/`pub`, not pnpm, and should stay out of the glob for the
same reason the Unity project does.
