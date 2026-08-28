---
sidebar_position: 5
---

import useBaseUrl from '@docusaurus/useBaseUrl';

# Android Client

`apps/android` — native Kotlin + Jetpack Compose, three Gradle modules. It
talks to the same backend as the desktop and web clients: no Android-only
API exists on any service. Where the client needs a reference
implementation to match, that's `apps/desktop/src/...` and the shared
contract in `packages/shared-types`.

<p style={{textAlign: 'center'}}>
  <img src={useBaseUrl('img/home-android.jpeg')} alt="BetweenUs Android client" style={{maxWidth: '360px', width: '100%', borderRadius: '12px', border: '1px solid var(--ifm-toc-border-color)'}} />
</p>

## Status

In progress, not yet shipping to real users the way desktop is. Register,
sign in, session restore, server switching, channels, messages, reactions
and voice have been run by hand on an emulator against a local backend, and
end-to-end encryption was cross-checked against the desktop client's own
crypto (same epoch, a re-key, still readable both directions). **Media —
calls, screen share and the remote-desktop viewer — has since been driven
two-device**, which is what a mesh needs to prove anything, along with push
notifications on a real phone, the local cache offline, and the APK
self-updater. Blocking, clearing your own history, password recovery and the
live username check landed since and compile and unit-test green, but have not
been on a device yet. So has the adaptive shell — two panes on tablets and
unfolded foldables — which has not been on one of those either. Full status, phase by phase:
[`development/ANDROID_TODO.md`](https://github.com/aiyu-ayaan/BetweenUs/blob/master/development/ANDROID_TODO.md).

## Modules

```text
apps/android/
  app/          Feature screens, DI wiring, the installable app
  core/          Networking, crypto, local persistence — no UI
  ui-common/      Compose design system shared by every feature
```

### `core`

```text
core/src/main/java/.../core/
  crypto/    ECDH device identity, channel-key wrap/unwrap, envelope codec
  data/       Repositories, DTOs matching packages/shared-types
  store/       Room database — servers, channels, DMs, messages, unread counts
```

The client opens on what it already knows: servers, channels, the DM list,
friends, unread counts and message history come off the local Room database
before anything is asked of the server — the same "show cache, then
reconcile" shape a modern chat client needs to feel instant on a cold start
over a slow connection.

### `app` — features

```text
feature/auth       feature/chat        feature/home        feature/members
feature/servers      feature/settings     feature/shell        feature/notifications
feature/remote          feature/update        feature/voice
```

- **`remote`** — a remote-desktop *viewer* only. The phone can watch and
  control an enrolled machine; it can't itself be enrolled as a target,
  since nothing on a phone can move a desktop's mouse. Same asymmetry as
  the web client (see [Architecture Overview](/architecture/overview)).
- **`settings`** — account profile, local crash reporter, call data usage, a
  **`PrivacyScreen`** (`Route.Privacy`) holding the block list and *Clear all my
  messages*, and a dedicated **`ThemesScreen`** (`Route.Themes`) providing live interactive workbench previews, 16 curated themes across 5 categories, and custom accent tint swatches with spring transitions.
- **`update`** — checks the app's own GitHub releases on launch (channel:
  alpha/beta/stable), downloads the APK built for the device's real ABI
  rather than the universal one, and hands it to Android's installer.
- **`voice`** — the same WebRTC mesh described in
  [Peer-to-Peer Media](/architecture/media), Android's own
  `RTCPeerConnection` bindings instead of the browser's.

## One shell, two shapes

The client used to draw a conversation with the channel list behind a
hamburger, on every device. That is right on a phone and wrong on everything
else — a tablet or an unfolded foldable has room for both, and hiding one
behind a button is throwing the screen away.

`shellFrame(width, hingeStart, hingeEnd)` in `:ui-common` decides:

| Window | Shape |
| --- | --- |
| `< 600.dp` | One pane. The channel list is a `ModalNavigationDrawer`. |
| `>= 600.dp` | Two panes. The list is permanent beside the conversation and the hamburger is **omitted**. |
| Vertical separating fold | The split lands on the fold and the seam is left empty. |
| Fold too near an edge | Ignored — a bounded proportional split (`280.dp`–`360.dp`) instead. |

It is a **pure function**, deliberately separated from the four lines of
`rememberShellFrame()` that read the window and the posture, because every
interesting case is a device nobody testing it will be holding: a foldable
half-opened, a hinge nearer one edge than the other, a folded foldable that is
a narrow phone with a seam behind the screen, a freeform window dragged narrower
while the app runs. Ten of them are asserted in `ShellFrameTest`.

Three details that are decisions rather than defaults:

- **The hamburger goes, rather than being drawn dead.** A button that opens a
  panel already open is a control that appears to do nothing, so the screens
  that draw one take a nullable callback.
- **A horizontal fold is not a hinge here.** Laptop posture does not divide the
  window left from right, so it never reaches the function.
- **Both layouts call the same two composables.** They are extracted rather
  than written once per branch — a second copy is a second place to add a
  callback to, and the one that gets forgotten is always the one on the device
  nobody is holding.

One dependency does it: `androidx.compose.material3.adaptive:adaptive`, whose
`currentWindowAdaptiveInfo()` answers both "how much room is there" and "is
there a hinge across it". `MainActivity` already declared
`screenSize|screenLayout|smallestScreenSize` in `configChanges`, so unfolding
resizes and recomposes instead of recreating the activity.

Not yet done: a third pane for the member list, which a 1280dp tablet has room
for and the desktop client already shows.

### `ui-common`

A dynamic Material 3 Expressive Compose design system shared across every feature module, plus `Adaptive.kt` — the window-size and folding-feature decision described above. Features:
- **Dynamic 16-Theme Palette Generation** (`BetweenUsColorPalette`, `LocalBetweenUsColors`, and `BetweenUsThemeTokens`).
- **Accent Customizer**: Dynamic override of active tokens across all Composable surfaces.
- **Spring Motion Scheme** (`BetweenUsMotion.spatial`, `BetweenUsMotion.effect`) driving predictive push/pop navigation transitions and animated category filtering.
- **Legacy Compatibility Layer**: Seamlessly binds `Ground`, `Surface*`, `Accent`, and `Slate*` call sites to dynamic active tokens.

## End-to-end encryption on Android

Same design as [E2EE](/security/e2ee): one ECDH P-256 device identity key
per installation, sealed refresh token via the Android Keystore, channel
keys wrapped per device. Nothing about the crypto is Android-specific
except where the private key is sealed.

## Sign-in from a phone

OAuth can't come back to a loopback port the way desktop's flow does — a
phone has no listener nothing else can steal. Instead the redirect targets
a private URL scheme (`betweenus://oauth`), bound to a PKCE-style challenge:
the client sends a SHA-256 of a random verifier when the flow starts and
must produce the verifier itself to redeem the one-time code, so an app
that merely intercepts the scheme (Android doesn't guarantee only one app
can register it) holds a code it can't spend. Detail:
[Auth & Permissions](/system-design/auth-and-permissions) and
[`development/SECURITY.md`](https://github.com/aiyu-ayaan/BetweenUs/blob/master/development/SECURITY.md).

## Blocking, clearing, and getting back in

The client speaks the same four account endpoints as desktop and web, and three
of them needed something here that the browser did not.

**A block is announced as an ordinary removal** — the far side is never told
which of the two it was. But the phone builds its conversation rail from a list
rather than deriving it from the friend list, so `friends.changed` reloads both.
Without that, the blocked conversation stayed in the rail and answered 404 when
tapped, which tells the far side exactly what the design was avoiding.
`Workspace` also removes the person from both lists at the moment of the call
rather than waiting for that announcement to come back round, because the screen
the button was pressed on has to be right immediately.

**`chats.cleared` reaches Room, not only memory.** The cache is what makes
opening the app not a spinner, and after a clear it holds envelopes the server
will no longer return — so `Conversation` drops the database, the decrypted
history and the paging cursors together, then re-opens whatever is on screen.
Clearing only the in-memory copy would have brought the whole thing back on the
next cold start.

**The username availability check is debounced *and* cancelled.** A plain
debounce still allows a slow answer about an earlier name to land after a faster
one about the name now in the field, reporting a free username as taken.

*Clear all my messages* sits behind a dialog rather than desktop's typed
confirmation — on a phone keyboard, a sentence somebody has to read is the
better speed bump. The forgot-password screen is the only client that states
what a reset costs before it happens: the identity backup is sealed with the old
password, so a phone signing in fresh afterwards reads what arrives from then
on, not what came before.

## Input sensitivity, and the hook that makes it possible

Noise suppression cleans up a signal; it does not decide that nobody is
talking, so a suppressed fan is a quieter fan, still in the call. What makes a
call silent between sentences is a **gate**: below a threshold the microphone
is closed. It is the single control that most changes what other people hear,
and it was the last of the desktop's audio controls the phone did not have.

It was written down as blocked by the platform for a long time, and the
reasoning was right about the two hooks anybody finds first:

| Hook | What it gives you | Why it cannot gate |
| --- | --- | --- |
| `setSamplesReadyCallback` | A **copy** of the buffer, after it has gone to the encoder | Too late to change what was sent. Fine for a meter. |
| `setMicrophoneMute` | Zeroes the buffer before the encoder | It zeroes it before that copy is taken too — so a gate driven from the meter reads its own silence the moment it closes and **can never reopen**. It latches shut. |

That latch is the trap, and it is why "a level meter driving a mute toggle"
was the honest description of what those two could build together.

`setAudioBufferCallback` is the third hook and it is the real one: it is handed
the **live capture buffer, in place, before it reaches the encoder**. So the
gate on Android is a gate in the same sense the desktop's AudioWorklet is one.
It measures the signal as it arrived, then attenuates the samples that are
about to be sent — and measuring first is exactly what keeps it able to open
again.

The constants are the desktop's, so a threshold set on a laptop means the same
thing on a phone: a 300 ms hold (speech is mostly gaps at this timescale —
every stop consonant is one), 6 dB of hysteresis (a voice sitting exactly on
the threshold would otherwise flutter the gate), a 5 ms attack (slower eats the
consonant that tells "bat" from "cat") and a 150 ms release (faster is an
audible click, because a waveform cut mid-cycle is a step edge). The ramp is
applied per sample; a buffer-wide gain step is a 10 ms staircase and a
staircase in the amplitude envelope is audible as zipper noise.

The settings screen draws the **pre-gate** level beside the slider. That is the
only way round it can be: a meter of the gated signal would sit at silence
exactly when somebody is trying to find the threshold that stops it doing that.
The meter only moves during a call — Android does not reliably allow a second
capture of one microphone, so the row says so rather than showing a bar that is
dead for a reason nobody can see.

## Push notifications

Firebase Cloud Messaging, data-only payloads — the server can't read a
message body to put words in a push, so the notification is written on the
device after it wakes. See
[notification-service](/services/notification-service) and
[`FCM/README.md`](https://github.com/aiyu-ayaan/BetweenUs/blob/master/FCM/README.md).
A direct call rings even with the app fully killed, via a `CallStyle`
notification with a full-screen intent.

## Building it

```bash
cd apps/android
./gradlew assembleDebug          # debug APK
./gradlew testDebugUnitTest        # unit tests
```

JDK 21. `local.properties` (git-ignored) sets `betweenus.serverUrl`, a
default only — the login screen's server picker can point the app anywhere
at runtime. See [Running Locally](/running-locally#android) and
[CI](/deployment/ci#android) for what runs on every pull request.
