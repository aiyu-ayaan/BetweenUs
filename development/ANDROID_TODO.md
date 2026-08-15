# Nexora Android — TODO

The Android client at `apps/android` is a native Kotlin + Jetpack Compose app.
It talks to the same backend as the desktop and web clients: no Android-only
API is added to any service. Where this document says "same as desktop", the
reference implementation is `apps/desktop/src/...` and the contract is
`packages/shared-types`.

Ordered backlog, one phase per commit-sized chunk. Check items off as they
land, and keep "Next up" honest — it is what a new session reads first.

## Next up

Phase 1 (foundation) and phase 2 (sign in) have landed: the app reads a default
server address out of `local.properties`, lets a person point it at another
deployment the way the desktop server picker does, signs in or registers
against `/api/v1/auth`, keeps the session across restarts, and lands on a
placeholder home screen.

Nothing after phase 2 exists yet. Phase 3 (servers, channels, messages over
REST) is the next thing worth building, because every later phase needs a
channel to attach itself to.

---

## Ground rules

- **Same backend, no new endpoints.** If Android needs something the desktop
  does not have, that is a signal to check the desktop again before touching a
  service.
- **Server address is configurable at runtime.** The build only supplies a
  default (`nexora.serverUrl` in `local.properties` →
  `BuildConfig.DEFAULT_SERVER_URL`). Switching servers signs the account out,
  because tokens and ids belong to the deployment that issued them.
- **No media server, ever.** Voice, video, screen share and the remote-desktop
  picture are peer-to-peer WebRTC, exactly as on desktop. The Android client
  gets its ICE servers from `call-service` and nothing else.
- **Three Gradle modules, and the dependency arrow only points one way.**

      :core        session, endpoint, HTTP, API client. No Compose, no UI.
      :ui-common   palette, type scale, shared widgets and marks. No business
                   logic and no knowledge of any endpoint.
      :app         features (a screen plus its ViewModel), the Application and
                   the Activity. The only module that knows about both others.

  A feature that wants a colour takes it from `:ui-common`; a widget that wants
  to know who is signed in is a widget in the wrong module.
- **No dependency-injection framework** until there is something to inject that
  a constructor cannot supply.
- **Design system is shared, not re-invented.** `:ui-common`'s `theme/Color.kt`
  mirrors `apps/desktop/tailwind.theme.mjs`. When that file changes, this one
  changes.

---

## Phase 1 — Foundation ✅

- [x] Compose scaffold, `minSdk 24`, `compileSdk 37`, edge-to-edge.
- [x] `:core` and `:ui-common` split out of `:app`.
- [x] `Nexora` colour ramp, typography and shapes ported from
      `apps/desktop/tailwind.theme.mjs` (ground, surface 500–950, accent, status,
      danger, hairline edge).
- [x] `local.properties` key `nexora.serverUrl` read at build time into
      `:core`'s `BuildConfig.DEFAULT_SERVER_URL`, defaulting to the emulator
      loopback `http://10.0.2.2:8080`.
- [x] `INTERNET` permission, and a network security config that permits
      cleartext — self-hosted boxes on a LAN are plain http, and Android cannot
      express "private ranges only" here. See the hardening phase.

## Phase 2 — Sign in ✅

- [x] `Endpoint`: normalise a typed address, remember a chosen one, fall back to
      the build default, probe `/api/v1/auth/oauth/providers` before committing.
      Mirrors `apps/desktop/src/services/endpoint.ts`.
- [x] `NexoraApi`: JSON over `HttpURLConnection`, bearer access token, single
      refresh on 401 with one retry. Mirrors `apps/desktop/src/services/api.ts`.
- [x] `Session`: access token in memory, refresh token and last email in
      prefs, restore on cold start.
- [x] Login / register screen with the same copy and shape as
      `apps/desktop/src/features/auth/LoginScreen.tsx`.
- [x] Server picker bottom sheet, including "back to the default"; switching
      signs out and recreates the activity.
- [x] Home placeholder showing the signed-in account and a sign-out.
- [x] `EndpointTest` covering address normalisation and probe-URL handling, the
      same cases as `apps/desktop/src/services/endpoint.check.ts`.

## Phase 3 — Servers, channels, messages (REST)

- [ ] `GET /api/v1/servers` list, server rail as a Compose drawer.
- [ ] Channel list per server; text channels only for now.
- [ ] Message history, pagination, send/edit/delete, replies.
- [ ] Direct messages and the DM list.
- [ ] Reactions.
- [ ] Attachments: pick, upload to `/api/v1/uploads`, render images inline.
- [ ] Markdown-ish message body rendering, matching
      `apps/desktop/src/services/message-body.ts`.

## Phase 4 — Realtime

- [ ] `/ws/chat` client with reconnect and backoff, carrying the access token.
- [ ] `/ws/presence`: online/idle/dnd/offline, typing indicators.
- [ ] Reconnect on token refresh, on network change and on app resume.
- [ ] Unread state and per-channel read markers.

## Phase 5 — Notifications (FCM)

This is the phase with real backend work in it, and the only place Android
needs something the desktop does not.

- [ ] Add `google-services.json` handling: file is git-ignored, its path and the
      project id come from `local.properties`; the build degrades to "no FCM"
      when it is absent so a clone still compiles.
- [ ] Firebase Messaging dependency + `FirebaseMessagingService` subclass.
- [ ] **Device token registry** in `notification-service`:
      `POST /api/v1/notifications/devices` `{ token, platform, deviceId }` on
      sign-in and on every `onNewToken`; `DELETE` on sign-out. Table keyed by
      user + device, storing the FCM registration token, the platform, the last
      seen time and the app version.
- [ ] Rotate with the session: an FCM token is bound to the account that
      registered it, so a sign-out or a server switch must delete the row before
      the tokens are discarded, and a refresh-token rotation must not orphan it.
- [ ] Server-side fan-out on `message.created` (mentions and DMs), on
      `call.started`, and on `remote.session.started`.
- [ ] Notification channels: messages, calls, remote access — separate, so a
      person can silence one without the others.
- [ ] Tap-through: deep link into the channel, the call, or the remote session.
- [ ] Foreground suppression: no notification for the channel already on screen.
- [ ] `POST_NOTIFICATIONS` runtime permission (API 33+), asked at the first
      moment it means something rather than on launch.
- [ ] Never log a registration token, an access token or a refresh token.

## Phase 6 — Voice and video

- [ ] WebRTC dependency (`io.github.webrtc-sdk:android` or equivalent) —
      the mesh, not an SFU.
- [ ] `/ws/call` signalling client: roster, offer/answer, ICE, matching
      `apps/desktop/src/services/mesh.ts`.
- [ ] One `PeerConnection` per other participant; the same 2–5 comfortable /
      6–8 degraded ceiling the desktop has.
- [ ] Mic capture, mute, speaker/earpiece routing, Bluetooth headsets.
- [ ] Camera capture, front/back switch.
- [ ] Foreground service + ongoing notification while in a call; call survives
      backgrounding and screen lock.
- [ ] Incoming-call UI, from an FCM push when the app is dead.
- [ ] Audio focus, ducking, and behaviour on an incoming phone call.

## Phase 7 — Screen share and viewing

- [ ] `MediaProjection` capture as an outbound share.
- [ ] Viewing someone else's share full-screen, with pinch-zoom.
- [ ] Quality ladder mirroring `share-quality.ts`.

## Phase 8 — Remote desktop (viewer only)

- [ ] `/ws/remote` session handshake and permission checks.
- [ ] Screen over WebRTC, direct to the agent.
- [ ] Touch → mouse mapping; a soft keyboard for key events.
- [ ] Clipboard and file transfer, each gated on its own permission.
- [ ] Audit trail is the gateway's job; the client only shows the state.
- [ ] No Android *agent* — a phone is a controller, not a target.

## Phase 9 — End-to-end encryption

- [ ] Port the identity/device key model from `apps/desktop/src/services/e2ee.ts`.
- [ ] Keys in the Android Keystore, not in prefs.
- [ ] Device verification and the backup secret flow.
- [ ] Decrypt history on a new device via the existing backup mechanism.

## Phase 10 — Settings and account

- [ ] Profile: display name, username, avatar upload.
- [ ] Password change, sessions/devices list, sign out everywhere.
- [ ] Notification preferences per server and per channel.
- [ ] Audio device and input-sensitivity settings.
- [ ] Theme: dark is the design; a light variant only if it is asked for.
- [ ] Server switcher reachable from settings, not just from the login screen.

## Phase 11 — Servers, roles and moderation

- [ ] Create/join a server, invites, invite links.
- [ ] Member list with presence and roles.
- [ ] Role and permission editing for those who hold `MANAGE_ROLE`.
- [ ] Channel create/rename/delete.
- [ ] Every one of these is enforced server-side; the UI only hides what the
      backend would refuse anyway.

## Phase 12 — OAuth sign-in

- [ ] Custom Tabs for the provider flow, matching the desktop's browser hand-off.
- [ ] App-link callback back into the session.
- [ ] Only offer providers the server actually reports.

## Phase 13 — Hardening and release

- [ ] Move the refresh token out of plain `SharedPreferences` into an
      encrypted store or the Keystore, and key it per deployment.
- [ ] Certificate handling for self-hosted deployments with a private CA.
- [ ] R8/ProGuard rules, shrink, and a release signing config sourced from
      `local.properties`.
- [ ] Instrumented tests for sign-in, server switch, send-message.
- [ ] Crash reporting, opt-in.
- [ ] CI: assemble debug on pull request, alongside the existing pnpm jobs.

---

## Deliberately out of scope

- **Live streaming.** Out of scope on every client while media is peer-to-peer.
- **An Android remote *agent*.** Controlling a phone is a different product.
- **An SFU.** If a call has to be bigger than a mesh can carry, that is a
  backend decision made once, for all clients, not an Android workaround.
