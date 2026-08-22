---
sidebar_position: 5
---

# Android Client

`apps/android` — native Kotlin + Jetpack Compose, three Gradle modules. It
talks to the same backend as the desktop and web clients: no Android-only
API exists on any service. Where the client needs a reference
implementation to match, that's `apps/desktop/src/...` and the shared
contract in `packages/shared-types`.

<p style={{textAlign: 'center'}}>
  <img src="/Nexora/img/home-android.jpeg" alt="BetweenUs Android client" style={{maxWidth: '360px', width: '100%', borderRadius: '12px', border: '1px solid var(--ifm-toc-border-color)'}} />
</p>

## Status

In progress, not yet shipping to real users the way desktop is. Register,
sign in, session restore, server switching, channels, messages, reactions
and voice have been run by hand on an emulator against a local backend, and
end-to-end encryption was cross-checked against the desktop client's own
crypto (same epoch, a re-key, still readable both directions). **Media —
calls and the remote-desktop viewer — is unverified**: a mesh needs two real
ends, and nobody has yet put two physical devices in a call or driven a real
agent's screen with this client. Full status, phase by phase:
[`development/ANDROID_TODO.md`](https://github.com/aiyu-ayaan/Nexora/blob/master/development/ANDROID_TODO.md).

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
- **`update`** — checks the app's own GitHub releases on launch (channel:
  alpha/beta/stable), downloads the APK built for the device's real ABI
  rather than the universal one, and hands it to Android's installer.
- **`voice`** — the same WebRTC mesh described in
  [Peer-to-Peer Media](/architecture/media), Android's own
  `RTCPeerConnection` bindings instead of the browser's.

### `ui-common`

A Compose design system shared across every feature module, so a screen
doesn't hand-roll its own button and card styles — the Android equivalent
of the desktop's shared Tailwind theme.

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
[`development/SECURITY.md`](https://github.com/aiyu-ayaan/Nexora/blob/master/development/SECURITY.md).

## Push notifications

Firebase Cloud Messaging, data-only payloads — the server can't read a
message body to put words in a push, so the notification is written on the
device after it wakes. See
[notification-service](/services/notification-service) and
[`FCM/README.md`](https://github.com/aiyu-ayaan/Nexora/blob/master/FCM/README.md).
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
