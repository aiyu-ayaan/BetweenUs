# Nexora Android — TODO

The Android client at `apps/android` is a native Kotlin + Jetpack Compose app.
It talks to the same backend as the desktop and web clients: no Android-only
API is added to any service. Where this document says "same as desktop", the
reference implementation is `apps/desktop/src/...` and the contract is
`packages/shared-types`.

Ordered backlog, one phase per commit-sized chunk. Check items off as they
land, and keep "Next up" honest — it is what a new session reads first.

## Next up

Phases 1 to 4 and 6 to 12 have landed in code. The client signs in, keys
itself, reads and writes end-to-end encrypted messages, holds both realtime
sockets, and has voice, screen share and a remote-desktop viewer built on the
same WebRTC mesh the desktop uses.

What has actually been in front of a human, on an emulator against a locally
running backend: register, sign in, session restore across a cold start, server
switch, create a server, open a channel, send a message, react to it, join a
voice channel, and be added to somebody else's server from another client and
watch it appear without a restart. Messages were checked on the server and hold
`{"v":1,"epoch":1,"iv":...,"ct":...}` - the plaintext never left the phone.

Two clients in one channel were also driven against each other, one of them a
script using the desktop's own crypto: same epoch, then a re-key, and messages
stayed readable in both directions across it.

**Everything to do with media is unverified.** A mesh needs two ends, and
nobody has put two devices in a call or driven a real agent's screen. Those are
the cases the design is built around and the ones most likely to be wrong.

Phase 5 (FCM) is the largest thing not started, and the only one that needs
backend work.

### Pointing a local build at a local backend

There is no gateway on port 8080 during `pnpm dev`. The desktop and web dev
servers each carry a Vite proxy table that stands in for Nginx, and Android
cannot use either of them, so it has to reach something that is actually
listening:

| Backend you are running | `nexora.serverUrl` in `apps/android/local.properties` |
| --- | --- |
| `pnpm dev` | `http://10.0.2.2:8090` — the development stand-in for Nginx, started as part of `pnpm dev`, and what everything past phase 2 needs |
| `pnpm dev:infra` (gateway container) | `http://10.0.2.2:8080` — the real thing |

The gateway is `scripts/dev-gateway.mjs`, which `pnpm dev` starts alongside the
services; `pnpm dev:gateway` runs it on its own when the services are already
up elsewhere. It routes every `/api/v1/*`
and `/ws/*` the way `infrastructure/nginx/nginx.conf` does, and exists because
Android cannot use the Vite proxy the desktop and web clients get. It listens
on 8090 rather than 8080 so it can run alongside the container stack — and
because on Windows 8080 often sits inside a reserved port range and cannot be
bound at all.

`10.0.2.2` is the emulator's route to the host's loopback, so it reaches a
locally running service without going near the LAN address or the host
firewall. A physical device has no such route and needs the host's LAN address
plus a firewall rule.

The value is only the default: the server picker on the login screen overrides
it at runtime, and that stored choice wins until it is changed or the app's
data is cleared.

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
      loopback. See the table above for which port to point it at.
- [x] `INTERNET` permission, and a network security config that permits
      cleartext — self-hosted boxes on a LAN are plain http, and Android cannot
      express "private ranges only" here. See the hardening phase.

## Phase 2 — Sign in ✅

- [x] `Endpoint`: normalise a typed address, remember a chosen one, fall back to
      the build default, probe `/api/v1/auth/oauth/providers` before committing.
      Mirrors `apps/desktop/src/services/endpoint.ts`.
- [x] `NexoraApi`: JSON over OkHttp, bearer access token, single refresh on a
      401 with one retry. Mirrors `apps/desktop/src/services/api.ts`.
- [x] `Session`: access token in memory, refresh token and last email in
      prefs, restore on cold start.
- [x] Login / register screen with the same copy and shape as
      `apps/desktop/src/features/auth/LoginScreen.tsx`.
- [x] Server picker bottom sheet, including "back to the default"; switching
      signs out and recreates the activity.
- [x] Home placeholder showing the signed-in account and a sign-out.
- [x] `EndpointTest` covering address normalisation and probe-URL handling, the
      same cases as `apps/desktop/src/services/endpoint.check.ts`.

## Phase 3 — Servers, channels, messages (REST) ✅

- [x] `GET /api/v1/servers` list, server rail as a Compose drawer.
- [x] Channel list per server; text channels only for now.
- [x] Message history, pagination, send, edit, delete, pin.
- [ ] Replies. The desktop has them; nothing here threads a message yet.
- [x] Direct messages and the DM list.
- [x] Reactions.
- [x] Attachments: pick, upload to `/api/v1/uploads`, render images inline.
- [ ] Markdown-ish message body rendering, matching
      `apps/desktop/src/services/message-body.ts`.

## Phase 4 — Realtime ✅

- [x] `/ws/chat` client with reconnect and backoff, carrying the access token.
- [x] `/ws/presence`: online/idle/dnd/offline, typing indicators.
- [x] Reconnect on token refresh, and on any socket failure with backoff.
- [x] Re-read the workspace on reconnect and on resume, which is what actually
      recovers from a socket that was away - nothing replays a missed event.
- [ ] Reconnect driven by a network-change callback, rather than waiting for the
      backoff timer to come round.
- [x] Unread state and per-channel read markers.
- [ ] An OS notification for a message that arrives while the app is open but
      the channel is not on screen. Everything is in place except the posting.

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

## Phase 6 — Voice and video ✅ (unverified)

- [x] WebRTC dependency (`io.github.webrtc-sdk:android` or equivalent) —
      the mesh, not an SFU.
- [x] `/ws/call` signalling client: roster, offer/answer, ICE, matching
      `apps/desktop/src/services/mesh.ts`.
- [x] One `PeerConnection` per other participant; the same 2–5 comfortable /
      6–8 degraded ceiling the desktop has.
- [x] Mic capture, mute, speaker/earpiece routing, Bluetooth headsets.
- [x] Camera capture, front/back switch.
- [x] Foreground service + ongoing notification while in a call; call survives
      backgrounding and screen lock.
- [ ] Incoming-call UI, from an FCM push when the app is dead.
- [ ] Audio focus, ducking, and behaviour on an incoming phone call.

## Phase 7 — Screen share and viewing ✅ (unverified)

- [x] `MediaProjection` capture as an outbound share.
- [ ] Viewing someone else's share full-screen, with pinch-zoom.
- [ ] Quality ladder mirroring `share-quality.ts`.

## Phase 8 — Remote desktop (viewer only) ✅ (unverified)

- [x] `/ws/remote` session handshake and permission checks.
- [x] Screen over WebRTC, direct to the agent.
- [x] Touch → mouse mapping; a soft keyboard for key events.
- [ ] Clipboard and file transfer, each gated on its own permission.
- [x] Audit trail is the gateway's job; the client only shows the state.
- [x] No Android *agent* — a phone is a controller, not a target.

## Phase 9 — End-to-end encryption ✅

- [x] Port the identity/device key model from `apps/desktop/src/services/e2ee.ts`.
- [x] Keys in the Android Keystore, not in prefs.
- [x] Device verification and the backup secret flow.
- [x] Decrypt history on a new device via the existing backup mechanism.

## Phase 10 — Settings and account ✅

- [x] Profile: display name, username, avatar upload.
- [x] Password change, sessions/devices list, sign out everywhere.
- [x] Notification preferences per server and per channel.
- [ ] Audio device and input-sensitivity settings.
- [ ] Theme: dark is the design; a light variant only if it is asked for.
- [x] Server switcher reachable from settings, not just from the login screen.

## Phase 11 — Servers, roles and moderation ✅

- [ ] Create/join a server, invites, invite links.
- [x] Member list with presence and roles.
- [x] Role and permission editing for those who hold `MANAGE_ROLE`.
- [x] Channel create/rename/delete.
- [x] Every one of these is enforced server-side; the UI only hides what the
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
