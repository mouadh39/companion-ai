# QA screenshots

Fifty-seven states captured from the app actually running — not mockups.
Flutter web release build, headless Chrome under a phone user agent, 390×844
logical at 2× (780×1688 px).

Captured 2026-08-31 against the `chore/phase-1.5-and-monorepo-foundation`
working tree, after the devices redesign and the light/dark appearance pass.

Every shot was reached by driving the real UI in one continuous session —
onboarding, the tab bar, the device catalogue, the pairing flow and the
settings tree. Nothing was rendered by jumping the app straight to a screen,
and the light shots were taken after switching the theme inside the app.

## Onboarding and presence

| # | File | State |
|---|---|---|
| 1 | `01-welcome.png` | Welcome |
| 2 | `02-auth-providers.png` | Sign up — provider list |
| 3 | `03-auth-phone.png` | Sign up — phone mode |
| 4 | `04-auth-passkey.png` | Sign up — passkey mode |
| 5 | `05-meeting-beat-1.png` | First meeting — beat 1 |
| 6 | `06-meeting-beat-2.png` | First meeting — beat 2 |
| 7 | `07-meeting-name.png` | First meeting — name entry |
| 8 | `08-assistant-idle.png` | Assistant — idle |
| 9 | `09-assistant-listening.png` | Assistant — listening |
| 10 | `10-assistant-speaking.png` | Assistant — speaking |

## Memory

| # | File | State |
|---|---|---|
| 11 | `11-memory-loading.png` | Memory — loading skeleton |
| 12 | `12-memory.png` | Memory — list |
| 13 | `13-memory-detail.png` | Memory — one entry |
| 14 | `14-memory-forget-confirm.png` | Memory — forget confirmation |
| 15 | `15-memory-empty.png` | Memory — empty state |

## Devices

The tab is a hub, not a catalogue: it answers what the account already has,
and how to add another. Everything Nexa merely *supports* lives one tap away
under **Add device**, so owned hardware is never buried under a shop.

| # | File | State |
|---|---|---|
| 16 | `16-devices-dark.png` | Devices — hub, with Add device |
| 17 | `17-devices-your-devices.png` | Devices — your devices, scrolled |
| 18 | `18-add-device-catalogue.png` | Add a device — available products |
| 19 | `19-catalogue-coming-soon.png` | Add a device — coming soon |
| 20 | `20-device-detail-available.png` | Device detail — not paired |
| 21 | `21-device-detail-available-actions.png` | Device detail — capabilities and action |
| 22 | `22-device-detail-coming-soon.png` | Device detail — coming soon |
| 23 | `23-device-detail-paired.png` | Device detail — connected |
| 24 | `24-device-detail-manage.png` | Device detail — information and manage |

## Pairing

The direction is fixed throughout: the phone finds the headset, connects to
it, then **displays** the TQRCG on its own screen, and the **headset's camera
reads it**. The phone's camera is not used at any point in this flow.

| # | File | State |
|---|---|---|
| 25 | `25-pair-intro.png` | Pair device — intro |
| 26 | `26-pair-guide-1.png` | Guide 1 — put on your headset |
| 27 | `27-pair-guide-2.png` | Guide 2 — open Nexa on your headset |
| 28 | `28-pair-guide-3-discovering.png` | Guide 3 — phone looking for the headset |
| 29 | `29-pair-guide-3-connected.png` | Guide 3 — connected |
| 30 | `30-pair-guide-4.png` | Guide 4 — complete pairing with your headset |
| 31 | `31-tqrcg-issuing.png` | TQRCG — preparing secure pairing |
| 32 | `32-tqrcg-showing.png` | TQRCG — code on the phone for the headset to read |
| 33 | `33-tqrcg-headset-reading.png` | TQRCG — the headset has read the code |
| 34 | `34-pair-complete.png` | Pairing complete |
| 35 | `35-devices-after-pairing.png` | Devices — the new headset is on the account |

## You

| # | File | State |
|---|---|---|
| 36 | `36-profile.png` | Profile |
| 37 | `37-settings.png` | Settings |
| 38 | `38-settings-voice.png` | Voice |
| 39 | `39-settings-appearance.png` | Appearance — theme and material |
| 40 | `40-settings-nexa.png` | Nexa — presence and behaviour |
| 41 | `41-settings-notifications.png` | Notifications |
| 42 | `42-settings-memory.png` | Memory settings |
| 43 | `43-privacy.png` | Privacy |
| 44 | `44-account.png` | Profile details |
| 45 | `45-security.png` | Security |
| 46 | `46-about.png` | About |
| 47 | `47-forget-everything-confirm.png` | Forget everything — confirmation |

## Light appearance

Same components, same spacing, same emerald — a warm off-white ground instead
of a near-black one, with the ink scale inverted and the accent stepped down
to a weight that reads on white.

| # | File | State |
|---|---|---|
| 48 | `48-appearance-light.png` | Appearance — Light selected |
| 49 | `49-settings-light.png` | Settings — light |
| 50 | `50-devices-light.png` | Devices hub — light |
| 51 | `51-devices-light-scrolled.png` | Devices hub — light, scrolled |
| 52 | `52-add-device-light.png` | Add a device — light |
| 53 | `53-catalogue-coming-soon-light.png` | Coming soon — light |
| 54 | `54-device-detail-light.png` | Device detail — light |
| 55 | `55-assistant-light.png` | Assistant — light |
| 56 | `56-memory-light.png` | Memory — light |
| 57 | `57-appearance-dark.png` | Appearance — Dark selected again |

## Reading them

At 390×844 the device frame does not draw — the app fills the viewport, which
is what a real phone shows. Widen past 470×884 and it renders inside the
rounded frame instead.

The mark breathes and drifts continuously, so its exact scale and angle differ
frame to frame. What should be consistent between 8, 9 and 10 is the
*progression*: 162 → 176 → 184 px, bloom 54 → 78 → 86, and the mic dot
squaring off from a circle the moment Nexa goes live. Under **Reduced motion**
every one of those loops parks at rest instead — the shape and the light stay,
only the movement goes.

Shot 7 shows the name field empty, with "Alex" as its placeholder. Type a
name and the call to action reads it back instead of saying "Continue".

Shots 28 and 29 are one stage: the phone discovers the headset and connects to
it before anything is shown. The call to action stays dimmed until the link
lands, because there is no point showing a code to a headset the phone cannot
talk to. There is no Bluetooth underneath yet — see `DeviceLinkService`.

Shots 31–33 are the TQRCG code, not a scanner: this phone issues the code and
puts it on its own screen, and the headset's camera reads it from there. That
panel stays dark-on-paper in **both** appearances, because a camera is reading
it rather than a person. The pattern itself is a placeholder drawn from the
token — the real encoding belongs with the protocol, which does not exist yet,
so pointing a real headset at it would not work.

Shots 34 and 35 are one sequence: the Quest 3S is paired in 34 and appears
under *Your devices* in 35. That is real state, not a second mock list.

Shot 15 is reached the honest way — *Settings → Memory → Forget everything*
(shot 47) — so the empty state is the same screen after a real operation.

There is no screenshot of the **empty devices hub**. It is implemented and
covered by a test, but it is not reachable from the demo data: the account
always has the phone the app is running on, and that phone cannot be
un-paired from itself. Faking it for a screenshot would misrepresent the
build.

Type is the platform sans, not Satoshi — see the note in the app README.
