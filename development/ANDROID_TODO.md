# BetweenUs Android — TODO

The Android client at `apps/android` is a native Kotlin + Jetpack Compose app.
It talks to the same backend as the desktop and web clients: no Android-only
API is added to any service. Where this document says "same as desktop", the
reference implementation is `apps/desktop/src/...` and the contract is
`packages/shared-types`.

Ordered backlog, one phase per commit-sized chunk. Check items off as they
land, and keep "Next up" honest — it is what a new session reads first.

## Next up

Phases 1 to 4, 6 to 12 and 14 have landed in code. The client signs in, keys
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

The client also opens on what it already knows: servers, channels, the DM
list, friends, unread counts and message history come off a local Room
database before anything is asked of the server. **This has not been in front
of a human yet** - it compiles and the codec round-trip test passes, and that
is all. A cold start with the network off, a second account on the same
device, and paging back through cached history are the three things to try
first.

**Everything to do with media is unverified.** A mesh needs two ends, and
nobody has put two devices in a call or driven a real agent's screen. Those are
the cases the design is built around and the ones most likely to be wrong.

Phase 5 (FCM) has landed for messages, along with the backend half it shares
with the web client - the device registry and the `message.created` fan-out,
phase 27 in `TODO.md`. A push is data-only and carries no words, because the
body is sealed and only the device knows whether that conversation is already on
screen; the notification is written here. `FCM/` documents all of it and
`FCM/TESTING.md` is what to try first, because **none of it has been on a real
device**. What is still open is the incoming-call UI for a dead app (phase 6),
which is now only the full-screen ringing UI: the `call.started` fan-out it was
waiting on exists, as `call.roster`.

### What a real deployment found

The client was driven against a live deployment from a phone for the first
time, and four faults fell out at once - all of them things an emulator against
a local backend had never reached:

- publishing wrapped channel keys never sent `senderDeviceId`, which the
  endpoint requires, so **the phone could read a channel key but never mint
  one**. A brand-new account could not send its first message until a web or
  desktop client had keyed the channel for it;
- sign-in dropped the password before `Session.start`, so **the identity backup
  was never opened on the way in and never uploaded on the way out of a
  registration** - and every sign-in ended in a prompt for the password just
  typed;
- a workspace refresh never loaded member lists, so **a voice roster read
  "Someone"** until the members screen had been opened once;
- settings drew the avatar twice, once in the account row and again as the
  picture picker's preview.

All four are fixed. Call signalling for a peer not yet on the roster is now
held rather than dropped as well - the impolite side offers exactly once, so a
dropped offer was a tile stuck on "connecting..." for the life of the call.
That one was a guess at the cause rather than a diagnosis, and the guess was
wrong; the real one is below.

### The call that connected about half the time

The symptom reported was directional - a call started from another client could
be joined from the phone, a call started *from* the phone carried nothing - and
then, on more attempts, "sometimes it works and sometimes it does not". The
second description is the true one, and it is what named the fault: nothing in
the mesh depends on who arrived first, so a failure that follows the direction
is a coin toss that happened to land the same way twice.

The coin is the peer id. It belongs to a **socket**, not to an account and not
to a call: `call-service` mints one when a connection opens and announces it
once, in `ready`. Both ends decide who offers by comparing the two ids, so they
always disagree - unless one of them is comparing an id the other has never
seen, in which case they can agree, and a call where both ends are polite is a
call where nobody ever offers.

Two ways the phone came to hold an id nobody else could see:

- `CallSocket` is a process-wide singleton and leaving a call never closed it.
  The engine's listener *was* removed, so the socket carried on reconnecting on
  its own - a lift, a screen going off, a network handover - and every
  reconnect earned a new peer id announced to nobody. The next call ran on that
  socket and computed politeness from the id of a connection that had died
  hours ago.
- The same thing inside a call: a reconnect rejoins, the far side sees a peer
  leave and a new one arrive and rebuilds its link against the new id, and this
  end kept a link built against the old one.

Both are fixed, and the fix is the shape the desktop already had. A call now
starts on a connection of its own - `teardown` closes the socket and forgets
the id - so `ready` is always heard and always this call's. And a `ready` that
announces a *different* id than the call was built on now discards the peer
links, which the roster in the following `joined` rebuilds against the identity
everybody else can see.

The two rules that hang off a peer id live in `CallIdentity.kt` with a test,
away from the engine: neither was reachable from a test while it sat inside a
class that needs WebRTC to construct, which is most of why it survived.

### Sending files

Sending used to run in the chat screen's own coroutine scope. It does not any
more: `Outbox` is a queue, handing a batch to it returns at once, and the work
carries on under `UploadService` - a foreground service with an ongoing
notification, which is both the disclosure Android requires and the progress
bar somebody wants. The composer draws the same progress above it.

A video is re-encoded to 720p H.264 at 2.5 Mbps by Media3's Transformer before
it is sealed, which is the difference between a clip arriving in seconds and a
clip arriving in ten minutes. Every failure path ends in "send what was
picked". Upload parts now go up three at a time rather than one.

There is a crop-and-rotate screen for pictures, shared in design with the
desktop's: `core/data/ImageEdit.kt` is a port of `services/image-edit.ts`, and
`ImageEditTest` mirrors that file's own self-check because the two clients frame
the same photograph and have to agree what "the frame" means.

**None of this has been in front of a human on a device.** The compression path
is the one to try first, on a long 4K clip, and then with the app backgrounded
mid-upload.

Everything else that was open here is tracked in `TRACK.md` and is being worked
through: markdown bodies, an emoji picker, audio
routing and ducking, the share quality ladder, remote clipboard and file
transfer, audio settings, server creation and invites, OAuth, and the whole of
phase 13.

### Pointing a local build at a local backend

There is no gateway on port 8080 during `pnpm dev`. The desktop and web dev
servers each carry a Vite proxy table that stands in for Nginx, and Android
cannot use either of them, so it has to reach something that is actually
listening:

| Backend you are running | `betweenus.serverUrl` in `apps/android/local.properties` |
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
firewall. It means nothing on a physical device, which is the usual reason a
build that works on the emulator cannot reach anything on a phone.

A phone needs three things instead, and no rebuild for any of them:

1. **The host's LAN address.** `pnpm dev:gateway` prints it at startup, next to
   the emulator one.
2. **A hole in the firewall for 8090.** Windows blocks inbound connections to a
   Node process by default, and the failure looks exactly like the server being
   down. Once, elevated:

   ```powershell
   New-NetFirewallRule -DisplayName "BetweenUs dev gateway" -Direction Inbound `
     -Protocol TCP -LocalPort 8090 -Action Allow -Profile Private
   ```

   `-Profile Private` on purpose: this opens the port on the home or office
   network the machine is on, and not on a public one.
3. **The address typed into the app.** The login screen has a server picker;
   `betweenus.serverUrl` in `local.properties` is only the default a build ships
   with, and changing it for a phone would break the emulator.

Both devices have to be on the same network. A host on Ethernet and a phone on
Wi-Fi is fine as long as it is the same router.

The value is only the default: the server picker on the login screen overrides
it at runtime, and that stored choice wins until it is changed or the app's
data is cleared.

---

## Ground rules

- **Same backend, no new endpoints.** If Android needs something the desktop
  does not have, that is a signal to check the desktop again before touching a
  service.
- **Server address is configurable at runtime.** The build only supplies a
  default (`betweenus.serverUrl` in `local.properties` →
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
- **The server is the authority; the cache only decides what is drawn first.**
  Nothing is read from the local database and treated as true. Every hydrate is
  followed by the request it stood in for, and the answer replaces it.
- **No plaintext on disk.** Cached messages are the envelopes the server sent.
  Decryption happens on the way to the screen and nowhere else, so the cache
  database is worth what the server's own rows are worth. Key material goes in
  the Keystore-sealed store, never beside the ciphertext.
- **No dependency-injection framework** until there is something to inject that
  a constructor cannot supply.
- **Design system is shared, not re-invented.** `:ui-common`'s `theme/Color.kt`
  mirrors `apps/desktop/tailwind.theme.mjs`. When that file changes, this one
  changes.

---

## Phase 1 — Foundation ✅

- [x] Compose scaffold, `minSdk 24`, `compileSdk 37`, edge-to-edge.
- [x] `:core` and `:ui-common` split out of `:app`.
- [x] `BetweenUs` colour ramp, typography and shapes ported from
      `apps/desktop/tailwind.theme.mjs` (ground, surface 500–950, accent, status,
      danger, hairline edge).
- [x] `local.properties` key `betweenus.serverUrl` read at build time into
      `:core`'s `BuildConfig.DEFAULT_SERVER_URL`, defaulting to the emulator
      loopback. See the table above for which port to point it at.
- [x] `INTERNET` permission, and a network security config that permits
      cleartext — self-hosted boxes on a LAN are plain http, and Android cannot
      express "private ranges only" here. See the hardening phase.

## Phase 2 — Sign in ✅

- [x] `Endpoint`: normalise a typed address, remember a chosen one, fall back to
      the build default, probe `/api/v1/auth/oauth/providers` before committing.
      Mirrors `apps/desktop/src/services/endpoint.ts`.
- [x] `BetweenUsApi`: JSON over OkHttp, bearer access token, single refresh on a
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
- [x] Replies. A quote inside the encrypted body - the author and one line of
      what was said, copied rather than pointed at, so a reply renders without
      fetching the message it answers. "Reply" in the long-press sheet, a
      banner over the composer, and a quote that scrolls to the message and
      flashes it.
- [x] Direct messages and the DM list.
- [x] Attachments: WhatsApp-style attachment sheet with inline recent photos/videos grid, Gallery (photos & videos picker), Camera capture via FileProvider, and Document picker (`OpenMultipleDocuments`), client-side encryption, upload to `/api/v1/uploads`, inline image and video rendering with fullscreen zoomable image viewer, integrated video player, and save to device gallery under `Pictures/BetweenUs` and `Movies/BetweenUs` media albums.
- [x] The list stays at the newest message while attachments arrive. Following
      is a latch released only by the reader scrolling up (`Follow.kt`, tested),
      because a row growing when its picture decrypts is not somebody scrolling
      away - which is what the previous rule, derived from the layout, decided
      it was. The desktop's `follow.ts` is the same rule, case for case.
- [x] A picture sent from here records its pixel size, so every client can
      reserve its space before the bytes arrive. It recorded none, which is why
      a photo from a phone was the one attachment that made the list jump.
- [x] A photo sent from here is converted to JPEG, downscaled to 1920px, and
      has its EXIF rotation baked into the pixels. HEIC is the reason: a phone
      camera writes it by default, this platform decodes it natively so it
      looked right *here*, and it arrived on desktop and web as a broken image
      because Chromium has never shipped a HEIF decoder. Those clients can now
      decode one, but a picture no browser can read has no business being sent,
      so the sender converts (`Conversation.asJpeg`).
- [x] The keyboard opening puts the list back on the newest message. The
      re-anchoring flow closed over `messages`, which on a channel opened
      before its first page arrived was empty for the life of the screen - so
      neither the keyboard nor a picture growing its row moved the list. It
      reads `layoutInfo.totalItemsCount` now.
- [x] Invites are links, and they are previewed before they are accepted.
      Creating, copying or sending one hands over
      `{deployment}/invite/{code}` rather than a bare code that looks like a
      typo in a chat and says nothing about which deployment it belongs to
      (`InviteLink`, the port of `services/invite-link.ts`, tested against the
      same cases). The join field takes a link or a code, and either way the
      code is looked up first and answered with a card - the server's name and
      icon, its member count and how many are online - so nothing is joined
      before somebody agrees to it.
- [x] Invites are one tap from the server they belong to. They were three -
      drawer, account settings, server settings - which is a long walk to
      answer "how do I add somebody".
- [x] Large attachments go up in parts, so the phone's ceiling is the
      deployment's - 100 MB - rather than 25 MB, which was never the file cap
      at all: it is the *per request* cap, and this client only knew how to
      send a file in one request. `Conversation.putBytes` is the port of the
      desktop's, sequential for the same reason. The upload also survives an
      access token expiring mid-file, which minutes of parts makes likely, and
      reports its progress into the send preview.
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
- [x] An OS notification for a message that arrives while the app is open but
      the channel is not on screen - posted by the push handler, see phase 5.

## Phase 5 — Notifications (FCM) ✅ for messages (compiles; never on a device)

The phase with real backend work in it, and the only place Android needs
something the desktop does not. The backend half is shared with the web client's
Web Push and is **phase 27** in `TODO.md`; `FCM/` in the repository root is the
documentation for all of it, and `FCM/TESTING.md` is the order to try it in.

The rule everything else follows: **the push is data-only and carries no
words.** The body is sealed with the channel key, so no service could write a
notification worth reading, and no service knows whether this phone is already
showing the conversation. Both decisions are made here.

- [x] `google-services.json` handling: git-ignored, read from
      `apps/android/app/`, with the Gradle plugin applied only when it exists -
      so a clone without one still compiles and installs.
      `BuildConfig.HAS_FIREBASE` is what the runtime reads.
- [x] Firebase Messaging + `PushService : FirebaseMessagingService`. Firebase is
      confined to `feature/notifications/Push.kt`; `:core` reaches it through
      `PushTokens.provider` and never depends on Play services itself.
- [x] **Device token registry** in `notification-service`:
      `POST /api/v1/notifications/devices`, `DELETE …/:deviceId`. Keyed on
      (user, installation) rather than on the token, because a token rotates.
- [x] Rotate with the session: registered on sign-in *and* on restore, so a
      token that rotated while the app was closed lands under the right account;
      `Session.signOut` unregisters before the tokens go.
- [x] Server-side fan-out on `message.created`.
- [x] Server-side fan-out on the other four: `message.deleted`,
      `friend.request` / `friend.accepted`, `server.member.added` and
      `call.roster`. `FCM/PAYLOADS.md` has the wire format of each and the
      reasoning behind the awkward parts.
- [x] **Deleting a message takes its notification with it.** A push with no
      words, sent to the whole audience with none of the filtering the message
      went through - every one of those gates is a way to leave a notification
      standing for something that no longer exists. The client rebuilds the
      conversation's notification without that line rather than cancelling it,
      because a conversation usually has more than one line; a thread with
      nothing left is the one case where the notification goes.
- [x] Friend requests, and somebody accepting one. Declining, cancelling and
      unfriending send nothing.
- [x] Being added to a server, minus the owner of a server they just made.
- [x] A call in a channel you can hear and are not in - the roster, not the
      arrival, so three people joining is one notification that keeps up rather
      than three that pile up. An empty roster cancels it, which is the only
      way a phone told about a call ever finds out it is over.
- [x] Notification channels: messages and remote access, beside the call channel
      `CallService` already owns; then "Friends and servers" and "Calls you can
      join", so a friend request can be turned down without turning a call down
      with it.
- [x] Tap-through: `betweenus://channel/<id>`, the same scheme an invite uses,
      plus `betweenus://friends` and `betweenus://server/<id>` for the two
      places a notification can lead that are not a conversation. A voice
      channel opened this way lands on the call screen with the join button
      rather than in a call: a notification tapped from a lock screen is not
      consent to open a microphone.
- [x] Foreground suppression: WhatsApp-style active chat channel suppression
      (`PushGate.shouldSuppress`). When the app is in the foreground and
      viewing a specific channel (such as Server 1 #general), push notifications
      for that active channel are silently suppressed because the conversation is
      already on screen. Push notifications for any other channel or server (such
      as Server 2 #general, or other channels on Server 1) still post normally,
      and notifications still post when the app is backgrounded or the screen is
      locked (`AppForeground`). Fully verified with unit test coverage in
      `PushGateTest.kt` covering exact channel/server isolation and lifecycle states.
- [x] The notification proper: `MessagingStyle`, the sender's picture, a
      decrypted image in the expanded view, direct reply from the shade (a
      broadcast, so it never opens the app), and mark-as-read.
- [x] `POST_NOTIFICATIONS` was already asked for at the first moment it means
      something; the post is skipped when it is refused.
- [x] Never log a registration token, an access token or a refresh token.
- [x] A call in a channel is now pushed - `call.roster`, see phase 5. What is
      still open below is the *ringing* UI, which is a full-screen intent and a
      different thing from a notification saying a call is happening.
- [ ] Incoming-call UI from a push with the app dead. Waits on a `call.started`
      fan-out that does not exist yet.
- [ ] A "reply" that fails offline is silently dropped. It should queue on
      `Outbox` the way a send from the composer does.

## Phase 6 — Voice and video ✅ (compiles; not yet seen working on a device)

- [x] WebRTC dependency (`io.github.webrtc-sdk:android` or equivalent) —
      the mesh, not an SFU.
- [x] `/ws/call` signalling client: roster, offer/answer, ICE, matching
      `apps/desktop/src/services/mesh.ts`.
- [x] The four fixed transceiver slots, in the desktop's order — mic, camera,
      screen, screen audio — created by the impolite side and adopted by the
      polite one. This is the interop contract, not an implementation detail;
      see the note below.
- [x] Perfect negotiation, and ICE candidates queued until there is a remote
      description to attach them to.
- [x] Media state over the negotiated `betweenus.share` data channel, so a muted
      microphone is told apart from a quiet room.
- [x] One `PeerConnection` per other participant; the same 2–5 comfortable /
      6–8 degraded ceiling the desktop has.
- [x] Mic capture, mute, speaker routing, audio focus.
- [x] Camera capture, front/back switch (dynamic camera flip support in `VoiceEngine.switchCamera()`).
- [x] WhatsApp/Modern mobile video call UI redesign (`VoiceChannelScreen.kt`):
      - Adaptive zero-scroll stage: 1-on-1 full-screen remote view + floating self PiP card.
      - 2-remote split stage and 3-4 remote 2x2 balanced grid.
      - 5+ participant hero active speaker stage with horizontal thumbnail strip.
      - Floating glassmorphic bottom control bar with circular actions (Flip camera, Video, Mic mute, Screen share, Audio device switch, and End call).
- [x] Foreground service with a `CallStyle` ongoing notification, hang-up and
      mute actions; call survives backgrounding and screen lock.
- [x] `POST_NOTIFICATIONS` asked for when a call is joined, alongside the
      microphone — refusing it does not refuse the call.
- [ ] Incoming-call UI, from an FCM push when the app is dead.
- [ ] Ducking, and behaviour on an incoming phone call.
- [x] Bluetooth and wired-headset routing, an output and an input picker in the
      call's control row, and the same two in settings. `BLUETOOTH_CONNECT` is
      asked for alongside the microphone: without the grant the platform reports
      no Bluetooth device at all, which is what "the headset is not detected"
      turned out to mean. See the note below.

### Finding a Bluetooth headset

Four separate reasons a paired headset was invisible, all of them fixed in
`CallAudio.kt`:

- `BLUETOOTH_CONNECT` - Android shows it as **Nearby devices** - is a runtime
  permission from API 31, and declaring it in the manifest is not holding it.
  Ungranted, `availableCommunicationDevices` reports no Bluetooth device, so the
  headset never reached a picker. It is asked for with the microphone when a
  call is joined, and is on the permission screen with the reason. Below 31 it
  does not exist and the install-time `BLUETOOTH` and `BLUETOOTH_ADMIN` are what
  the platform wants instead, both capped at `maxSdkVersion="30"`.
  `BLUETOOTH_SCAN` is deliberately not asked for: it is for discovering devices
  that are not paired yet, which is the system's settings app and not this
  app's business.
- Outside a call, a headset is an A2DP output; it becomes `TYPE_BLUETOOTH_SCO`
  only once the audio mode is `MODE_IN_COMMUNICATION`. The device-type mapping
  knew only the SCO spelling, so settings - which reads the list with no call
  running - saw a phone with no Bluetooth on it. Both spellings map now, along
  with BLE headsets and hearing aids.
- `AUTO` was not automatic. It set the speakerphone flag, which is a decision,
  and the wrong one for somebody wearing a headset. It now picks the headset
  when there is one, wired next, speaker last.
- Below API 31 `setCommunicationDevice` does not exist and the speakerphone flag
  cannot name a headset; `startBluetoothSco` is the fallback, and it is also
  what runs above 31 when the new API cannot see a device the old one can route
  to.

The device lists are live rather than read once, through an `AudioDeviceCallback`
- a headset is put on *during* a call more often than before one, and a call on
`AUTO` follows the change.

Android routes a call as one communication device, not as a pair, so choosing a
headset's microphone puts playback in that headset too. The sheet says so rather
than pretending the two are independent.

### The slot contract

Both clients build every connection with exactly four transceivers in one
order — mic, camera, screen, screen audio — and identify what arrived by which
slot it came in on. Only the impolite side creates them; the polite side adopts
the four the offer brought.

Android did not do this at first. It added whatever it happened to be
capturing, so a phone offered a desktop one audio m-line where four were
expected, the desktop's `adopt` refused to run, and it put no track on the wire
at all. Both ends showed two connected tiles and carried nothing in either
direction — the exact failure the desktop comment warns about, arrived at from
the other side.

A phone never sends on the screen-audio slot: Android's playback capture needs
its own consent flow and is not wired up. The slot still exists, because
dropping it would shift every m-line after it.

Anything changing the slots has to change both clients in the same commit.

## Phase 7 — Screen share and viewing ✅ (unverified)

- [x] `MediaProjection` capture as an outbound share.
- [x] Viewing someone else's share full-screen, with pinch-zoom, pan and
      double-tap to reset.
- [x] Orientation the viewer chooses, overriding the phone's rotation lock, and
      handed back when the stage closes.
- [ ] Quality ladder mirroring `share-quality.ts`.

A share is not another tile in the grid. It is usually text, and text in a
quarter of a phone screen is not text, so an arriving share takes the whole
display and the call controls come along on an overlay. Closing it goes back to
the grid and is remembered per peer, so it does not reopen on the next stats
poll - only a share that stops and starts again does that.

## The call outlives its screen

A call belongs to the process, like the session and the workspace, and only
leaving ends it. It used to be `remember`ed inside the call screen, which meant
a rotation ended it, navigating to a channel ended it, and - worst - tapping
the ongoing notification ended it: the default launch mode built a second
`MainActivity` over the first, so the call screen was destroyed and the new one
started at the home screen. The activity is `singleTask` now and the intent
says so too; both halves are needed.

## Phase 8 — Remote desktop (viewer only) ✅ (unverified)

- [x] `/ws/remote` session handshake and permission checks.
- [x] Screen over WebRTC, direct to the agent.
- [x] Touch → mouse mapping; a soft keyboard for key events.
- [x] Machine management from the phone: rename, remove, who holds which
      permission, and the audit trail. These were desktop-only, which put the
      decisions about who may reach a machine on one device and the access
      itself on every device - backwards for the one feature where taking
      access back in a hurry is the point.
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
- [x] Audio device settings: where a call plays and which microphone it uses,
      both live-updating and both also on the call screen.
- [x] A global permission screen, shown once after signing in and reachable from
      settings afterwards: every permission the app can ask for, with what each
      one buys. It is a disclosure and not a gate - each is still requested at
      the moment it is needed, so anything skipped there can be granted by
      tapping the thing that wanted it.
- [ ] Input-sensitivity setting. Android's WebRTC has no insertion point on the
      capture path short of a custom audio device module; see `TRACK.md`.
- [ ] Theme: dark is the design; a light variant only if it is asked for.
- [x] Server switcher reachable from settings, not just from the login screen.

## Phase 11 — Servers, roles and moderation ✅

- [x] Join a server with an invite code, and create one. The sheet asks for a
      code rather than a slug, because a slug is a name and no longer opens a
      door.
- [x] Managing invites from the phone: minting one with an expiry and a use
      limit, copying or sending it as a link, and revoking it.
- [x] A link that opens the app: `betweenus://invite/{code}`. Not an https app
      link - the deployment's host is unknown at build time, BetweenUs being
      self-hosted, so an `https://…/invite/…` filter would either name a host
      wrong for everybody or claim every https link on the phone. The code is
      left in `PendingInvite` and the shell opens the card, so a link still
      joins nothing on its own. An `https://` link pasted into *Join a server*
      keeps working, which is what the desktop's links are.
- [x] Member list with presence and roles.
- [x] Role and permission editing for those who hold `MANAGE_ROLE`.
- [x] Avatars and server icons set from the phone, squared and scaled in the
      client the way the desktop does it. The upload call existed and nothing
      called it. `Session.updateUser` came with it: the signed-in account was
      written once at sign-in and never again, so a display name saved to the
      server and left the old one on screen until the next launch.
- [x] A server's own emoji: added from the photo picker and removed, with the
      name rules checked before anything is uploaded. An animated file is
      stored exactly as it came; everything else is squared and scaled to PNG
      by `Pictures.square`, which keeps the transparency an emoji is half made
      of. Drawing them already worked - adding one did not.
- [x] A server's own roles: made, edited, coloured and deleted from the phone,
      and handed to members from the member sheet. Only the handing out existed
      before, which meant the list to choose from could only ever have been
      filled in from a desktop. The assignable permission list moved into
      `core`; the copy beside the member sheet had drifted from
      `packages/permissions` and was missing `MANAGE_MESSAGE` and
      `MANAGE_EMOJI` entirely.
- [x] Channel create/rename/delete.
- [x] Every one of these is enforced server-side; the UI only hides what the
      backend would refuse anyway.

## Phase 12 — OAuth sign-in ✅

- [x] Custom Tabs for the provider flow, matching the desktop's browser
      hand-off. Not a WebView: it is somebody's Google account, they are
      already signed in to it in their own browser, and Google refuses an
      embedded WebView anyway.
- [x] Callback back into the session over `betweenus://oauth`, bound to a
      challenge this app keeps (`OAuthFlow`). A private scheme is not
      exclusively ours - another app can register it - so the one-time code
      that comes back is worthless without the verifier, which never leaves
      here. `SECURITY.md` has the reasoning; the digest is pinned against the
      server's in a unit test, because the two disagreeing would only show up
      as a sign-in that fails after the browser round trip.
- [x] Only offer providers the server actually reports, and draw nothing at all
      when it reports none.

## Phase 13 — Hardening and release

- [ ] Move the refresh token out of plain `SharedPreferences` into an
      encrypted store or the Keystore, and key it per deployment.
- [ ] Certificate handling for self-hosted deployments with a private CA.
- [ ] R8/ProGuard rules, shrink, and a release signing config sourced from
      `local.properties`.
- [ ] Instrumented tests for sign-in, server switch, send-message.
- [ ] Crash reporting, opt-in.
- [ ] CI: assemble debug on pull request, alongside the existing pnpm jobs.

## Phase 14 — Local cache ✅ (compiles; not yet seen working on a device)

Opening the app used to mean an empty server rail and an empty channel until
the network answered, and nothing at all when it did not: everything the UI
drew was fetched fresh on each launch and held only in memory.

- [x] Room in `:core`, behind `store/Cache.kt`. No DAO and no entity is visible
      to another module, or to another package.
- [x] `Workspace` hydrates servers, channels, DMs, friends, members and unread
      counts from disk before its first request, and writes back every load.
- [x] `Conversation` opens a channel from the cache, then merges the fresh page
      over it rather than replacing it - the page is the newest 50, and a
      replace would throw away history somebody had already scrolled to.
- [x] Paging back reads the database first and only goes to the network when it
      runs out, so scrolling through a conversation a second time is a local
      read.
- [x] Channel keys persist, in the Keystore-sealed store. Without them a cached
      envelope is unreadable and the cache buys nothing.
- [x] The cache belongs to one account. `Cache.claim` wipes it when the user id
      changes and every read waits on it, so a second account cannot flash the
      first one's servers on screen.
- [x] A deliberate sign-out empties it; a session that merely expired keeps it,
      so signing back in is still instant.
- [x] `CacheCodecTest` round-trips every cached model. `toJson` is written
      against `from`, and the two drift silently - a forgotten field comes back
      as a default, not as a crash.
- [ ] Seen working on a device: cold start with the network off, two accounts on
      one device, paging back through cached history.
- [ ] Presence is deliberately not cached. A stale "online" is worse than no
      answer, and it arrives on a socket within a second of connecting.
- [x] Attachments are no longer fetched every time they are *drawn*.
      `MediaCache` in `:app` holds what a row has already paid for - the decoded
      bitmap, a video's first frame, and the `Uri` of the plaintext file - keyed
      on the attachment key, bitmaps bounded to an eighth of the heap and
      evicted oldest-first. Without it a `LazyColumn` disposing a row threw all
      of that away, so scrolling a picture off the screen and back downloaded
      it, decrypted it and decoded it again, and a photo that had been on screen
      a second ago was a spinner. Emptied on sign-out and on changing server.
- [ ] It is a cache for this run of the app, not for the next one. Caching the
      *ciphertext* next to the message, in the Room database the rest of the
      cache already uses, is the version that survives a restart - and nothing
      here blocks it.

`android.disallowKotlinSourceSets=false` in `gradle.properties` is part of this
phase: AGP 9's built-in Kotlin rejects source sets added through the `kotlin`
DSL, which is how KSP registers what Room generates. It goes when KSP starts
registering through `android.sourceSets`.

---

## Deliberately out of scope

- **Live streaming.** Out of scope on every client while media is peer-to-peer.
- **An Android remote *agent*.** Controlling a phone is a different product.
- **An SFU.** If a call has to be bigger than a mesh can carry, that is a
  backend decision made once, for all clients, not an Android workaround.
