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

Three call changes landed since and are in the same unverified state - they all
need a real phone, and two of them need a real cellular call:

- **A call on hold.** Another app taking the audio - a phone call, on a phone -
  already closed the microphone. It now says so: the hold travels with the media
  state over the data channel, so the far end draws "On hold" instead of a
  muted tile, and this end gets a banner. What to try: be in a BetweenUs call,
  take an ordinary call, and watch both screens; then end the ordinary call and
  watch the BetweenUs one come back by itself.
- **Resuming after a permanent focus loss.** A transient loss ends in
  `AUDIOFOCUS_GAIN` and the call resumes itself; a permanent one has nothing
  coming, so the focus is asked for again when the call screen returns to the
  front, and from a Resume button on the banner. The case to force is a second
  VoIP app taking the audio for good.
- **The call bar fits.** Six fixed buttons and fixed gaps came to about 400dp,
  which is wider than the phone: the bar ran off the right edge and took the
  hang-up button with it. Worth looking at on the narrowest device to hand.

The reconnecting banner is new too: a socket that has been down for thirty
seconds is given up on rather than retried more slowly, and the bar offers a
button that starts again. Flight mode on and off is the whole test.

Phase 5 (FCM) has landed for messages, along with the backend half it shares
with the web client - the device registry and the `message.created` fan-out,
phase 27 in `TODO.md`. A push is data-only and carries no words, because the
body is sealed and only the device knows whether that conversation is already on
screen; the notification is written here. `FCM/` documents all of it and
`FCM/TESTING.md` is what to try first, because **none of it has been on a real
device**. A direct call now rings from a push with the app dead - a `CallStyle`
notification with a full-screen intent onto its own activity - and that is the
one thing on this list most in need of a real phone: a full-screen intent is
the feature manufacturers differ most about.

Phase 15 has landed: the app checks its own GitHub releases on every launch,
on a channel of alpha, beta or stable, downloads the APK built for the device's
ABI rather than the universal one, and hands it to Android's installer. Install
or snooze, a day by default. **Not on a device yet** - the rules are unit
tested and the rest compiles.

Phase 13 has landed apart from the light theme. The refresh token is sealed by
the Keystore and keyed per deployment, a private CA is handled by trusting what
the phone's owner installed, signing reads a keystore from the environment or a
git-ignored file beside the project, crash reporting is opt-in and local, and
CI builds the debug APK on every pull request.

**Three items are open and two of them are blocked on something that is not
this client.** Input sensitivity needs an insertion point on Android's WebRTC
capture path that does not exist short of a custom audio device module. Remote
file transfer needs a wire: there is no file message in the gateway's
vocabulary, nothing on the desktop agent that would receive one, and a remote
session opens no data channel to carry it. The light theme is open on its own
terms - the palette is forty top-level constants used directly by thirty-five
files, and nothing about a light BetweenUs has been designed.

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

### The self-view that was always empty

Reported from a real call: the far end arrived and filled the screen, and the
little self-view in the corner was a blank box - still offering its flip
button, so something believed a camera was running.

Two faults, both in how a `SurfaceViewRenderer` was being built, and both
repeated in all four places that built one by hand.

- **A new capture is a new `VideoTrack`.** `startCamera` disposes the capturer
  and the track and makes another, which is what flipping the camera does -
  `switchCamera` is `startCamera` with the other lens. `AndroidView` will not
  rebuild its view for that, because nothing about its factory changed, so the
  renderer stayed sunk into a disposed track and the tile went empty for good.
  Nothing in the state flow says otherwise either: the track goes null and
  non-null inside one frame, so Compose never sees the null and never takes the
  branch that would have made a new renderer.
- **A `SurfaceView` over a `SurfaceView` is behind it.** Unless it says
  `setZOrderMediaOverlay(true)`, the second one punches a hole through the
  first instead of drawing into it. That is the self-view over a full-screen
  peer, and the filmstrip over a share - both of them a blank box over a
  picture that was arriving perfectly well.

Both live in `VideoSurface.kt` now, which is the only place in the app that
turns a track into pixels. `key(track)` is the first fix and the overlay flag
the second; the self-view is mirrored there too, which is what a front camera
should look like to the person in front of it.

### The corners the self-view never had

A `SurfaceView` is not clipped by anything in the window: it is a separate
surface the system composites, so `Modifier.clip` above it does nothing and
every rounded tile had square video corners inside a rounded border.
`VideoSurface` works around it by painting the four corner slivers back in over
the surface - which is correct only while the tile sits on a known, opaque
background. The floating self-view does not: it floats over whoever else is in
the call, so its corners came out as four blocks of the tile's own background
instead of the picture behind it.

`ClippedVideo.kt` is the fix, and it is a different renderer rather than a
different mask. A `TextureView` is drawn by the window like any other view, so
it clips, it composites with what is under it, and it stacks by ordinary view
order instead of needing `setZOrderMediaOverlay`. `EglRenderer` drives it
directly, with the view's own aspect handed to `setLayoutAspectRatio`, which is
what makes it crop rather than letterbox.

It costs a copy per frame, so only the small floating tile uses it. The
full-screen tiles and the share stage keep `SurfaceViewRenderer`: they have an
opaque background for the mask to work against, and they are the ones where the
per-frame cost would be paid on the whole screen.

### The tile that said "connecting…" for the life of the call

Two faults, both of them a link with no way back.

The channel-key re-read was allowed once per peer and then never again, so a
link could survive exactly one epoch change. One is normal - joining a channel
you hold no key for mints the next epoch, which is what a device arriving does -
and burning it on the first description left every one after that refused
against a key known to be stale, with nothing left that would ever look again.
It is a five-second cooldown now, which keeps what the latch was for: a proof
that is simply wrong still cannot make this client hammer the key directory.

And nothing chased an offer that was never answered. `onConnectionChange` only
reaches `FAILED` once ICE has a remote description to fail against, so a refused
offer leaves the connection in `NEW` with no callback ever fired - and both the
recovery loop and the ICE restart hang off a failure that never happens. The
offering side now re-offers from `NEW`, up to `CallRecovery.MAX_ATTEMPTS` times,
re-reading the key first. Only the impolite side, because only it may offer, and
only from `NEW`: a connection with a remote description is negotiating, and
offering over the top of a slow network would break the calls that were about to
work.

### Incoming video that flickered

A video slot counts as live once a frame has actually been decoded on it, because
a receiver unmutes on the padding Chromium sends to probe for bandwidth - so a
camera nobody turned on would otherwise be a black rectangle where an avatar
goes.

The reading was taken fresh from every `getStats` report, and a report is not a
promise: one arrives without this slot's `inbound-rtp` entry after a
renegotiation, and a mid can change under one. Missing read as nought frames
decoded, which took the track away and put it back a poll later - the flicker.
`framesDecoded` only grows, so the answer is latched per slot, which is what the
desktop client has done since the same bug was fixed there.

### The call is the whole screen, and survives leaving it

Three things a phone call is expected to do, and did not:

- The status and navigation bars sat over the call. They are hidden for as long
  as one is running and put back when it ends. A swipe from an edge still
  brings them back transiently, which is the only way out of a full-screen app
  the platform guarantees.
- The peer's name pill was underneath the floating control dock. It is lifted
  clear of it - but only while the dock is there. Held up against nothing, it
  floated in the middle of somebody's chest instead of sitting where a caption
  sits, so the lift follows the chrome.
- Back ended the call. It now shrinks the activity into system
  picture-in-picture - `CallPip.kt`, and `supportsPictureInPicture` on the
  activity - so the call carries on in a floating window with no peer
  connection rebuilt and no renderer recreated. Back means what it usually
  means only if the system refuses. In that window there is room for the
  picture and nothing else, so the header, the dock and the problem banner are
  not drawn - and neither is the self-view, or the grid. One tile's worth of
  room goes to whoever is talking, which is never you: your own camera is the
  one face in the call you are not there to watch. It is sticky on the last
  speaker, because a conversation is mostly gaps and a window that flicked
  between faces through every pause would be worse than a fixed one.

The self-view can also be dragged anywhere on the stage, clamped to the screen
so it cannot be thrown off an edge. There is no snap-to-corner.

### Sending files

Sending used to run in the chat screen's own coroutine scope. It does not any
more: `Outbox` is a queue, handing a batch to it returns at once, and the work
carries on under `UploadService` - a foreground service with an ongoing
notification, which is both the disclosure Android requires and the progress
bar somebody wants. The composer draws the same progress above it.

**And that is now true of every attachment, not only the ones with a
thumbnail.** A PDF, a spreadsheet or an audio file took a second path: read,
sealed and uploaded inline in the chat screen the instant it was picked, in
that screen's scope, which dies with the screen - so leaving the channel or
taking a call killed the upload with its parts already in object storage. It
also meant the one thing nobody could do was check what they had picked before
it went. Everything now lands in the send preview, where a file with nothing to
look at gets a card with its name and type, and sending hands the whole batch
to `Outbox`. The composer's attachment chips and its spinner went with the old
path, along with the preview's own busy state: a hand-off that returns at once
has nothing to wait on.

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
mid-upload - and now the same test with a large PDF, which is the case that
used to die and should not any more.

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
- [x] Markdown-ish message body rendering. `core/data/Markup.kt`: bold,
      italic, strikethrough, inline code, fenced code and quoted lines, with
      the marks *removed* - which is the part with a bug in it, because every
      span is then an index into the text that comes back. The emoji splitter
      runs over that same string afterwards and appends each shortcode as
      alternate text of the same length, so the offsets still line up.
      `MarkupTest` asserts both halves of every case.

## Phase 4 — Realtime ✅

- [x] `/ws/chat` client with reconnect and backoff, carrying the access token.
- [x] `/ws/presence`: online/idle/dnd/offline, typing indicators.
- [x] Reconnect on token refresh, and on any socket failure with backoff.
- [x] Re-read the workspace on reconnect and on resume, which is what actually
      recovers from a socket that was away - nothing replays a missed event.
- [x] Reconnect driven by a network-change callback, rather than waiting for the
      backoff timer to come round. `core/data/Network.kt` registers a
      `NetworkCallback`; `onAvailable` wakes every socket at once. A lost
      network is not treated as offline on its own, because a handover loses
      the old one while the new one is already carrying traffic.
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
- [x] Incoming-call UI from a push with the app dead. `call.roster` is the
      fan-out it was waiting for. A direct conversation rings - a `CallStyle`
      notification with a full-screen intent onto `IncomingCallActivity`, which
      shows over a locked phone because that is an activity property and
      `MainActivity` must not have it for every launch. A server's voice
      channel keeps the quiet notification: a phone that rings for every call
      happening nearby is a phone somebody turns notifications off on.
      Declining lasts as long as the call, because every arrival is another
      roster push.
- [x] A reply that fails offline is kept rather than dropped. It goes to disk
      before it is sent - a broadcast receiver is killed the moment it returns,
      so the in-memory queue was the wrong shape for it - and out again on the
      next validated network or the next launch. The thread says "sending…"
      until it has gone, and signing out throws unsent words away rather than
      sending them as whoever signs in next.

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
- [x] One renderer path, `VideoSurface.kt`: a new `VideoTrack` makes a new
      renderer, and a tile drawn over another one says so. See the note above -
      the self-view was a blank box in every call without both.
- [x] Full-screen while a call is running; the system bars come back when it
      ends.
- [x] Back shrinks the call into system picture-in-picture rather than ending
      it (`CallPip.kt`). It needs no permission: nothing to declare, nothing to
      ask for, only `supportsPictureInPicture` and a wide enough `configChanges`
      on the activity, both of which the manifest already has. It has three ways
      to be refused instead - a device with none, the per-app switch under
      Settings → Apps → Special app access, and an activity that is finishing or
      not in front - and `enter` returns false for all three rather than
      throwing, so backing out on a phone without picture-in-picture simply
      leaves the screen. Whether the call *is* the floating window is asked of
      the activity on every recomposition rather than cached against a
      `Configuration`, which is compared by value and so could hold the old
      answer. `addOnPictureInPictureModeChangedListener` would say it more
      directly and is not available: androidx.activity 1.13 removed it.
- [x] The self-view can be dragged anywhere on the stage.
- [x] WhatsApp/Modern mobile video call UI redesign (`VoiceChannelScreen.kt`):
      - Adaptive zero-scroll stage: 1-on-1 full-screen remote view + floating self PiP card.
      - 2-remote split stage and 3-4 remote 2x2 balanced grid.
      - 5+ participant hero active speaker stage with horizontal thumbnail strip.
      - Floating glassmorphic bottom control bar with circular actions (Flip camera, Video, Mic mute, Screen share, Audio device switch, and End call).
- [x] Foreground service with a `CallStyle` ongoing notification, hang-up and
      mute actions; call survives backgrounding and screen lock.
- [x] `POST_NOTIFICATIONS` asked for when a call is joined, alongside the
      microphone — refusing it does not refuse the call.
- [x] Incoming-call UI, from an FCM push when the app is dead. See phase 5.
- [x] Ducking, and behaviour on an incoming phone call. Audio focus was
      requested with no listener, so a cellular call left the microphone open
      and the room going out over it. A transient duck lowers what the call
      plays; a loss closes the microphone and tells the far end. No telephony
      permission - taking the audio is how the platform announces a call.
- [x] Bluetooth and wired-headset routing, an output and an input picker in the
      call's control row, and the same two in settings. `BLUETOOTH_CONNECT` is
      asked for alongside the microphone: without the grant the platform reports
      no Bluetooth device at all, which is what "the headset is not detected"
      turned out to mean. See the note below.
- [x] **The connection panel.** Bitrate, loss, round trip and frame size per
      peer, and the sentence saying which of them is bad enough to be what
      somebody is hearing. `CallStats.kt` is a port of the desktop's
      `services/call-stats.ts`, with `CallStatsTest` mirroring its self-check -
      two clients in one call must not disagree about what 5% loss is. It rides
      on the `getStats` poll that was already running.
- [x] **Reconnection, and the deadlines that end a call.** A link that stops
      carrying media is retried with an ICE restart and a re-offer, backed off,
      four attempts inside thirty seconds. Before this the single
      `restartIce()` on `FAILED` did nothing whatsoever: a restart recovers
      nothing unless somebody offers, and nothing acts on
      `onRenegotiationNeeded` here. Only the impolite side restarts, for the
      same reason it is the only side that offers. Tiles say "Reconnecting…"
      and then "No connection"; the peer connection is left open, because who
      is in a call is the roster's answer. Above that, two whole-call
      deadlines: forty-five seconds with no signalling, and five minutes alone.
      `CallRecovery` is the policy and is tested.
- [x] **The speaking ring on your own tile.** It read a peer connection's
      inbound statistics, and no peer connection carries your own microphone,
      so every self tile passed a hardcoded `false`. The level comes off the
      microphone itself now, which also works alone in a channel - where there
      are no statistics and where "is this picking me up?" is the question.

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

That callback used to live in `rememberCallDevices`, which exists only while the
device sheet is open - so the one gesture it was for, putting a headset on
mid-call, moved nothing unless the picker happened to be up at that moment. It
is registered by `CallAudio.start` and torn down by `CallAudio.stop` now, for
the length of the call. A route or an input pinned to a device that has since
been unplugged cannot be honoured, so it goes back to `Automatic` and
re-resolves rather than asking for something that is not there - which is the
failure with no sound to it.

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
- [x] Quality ladder mirroring `share-quality.ts`. `ShareQuality.kt`, with the
      same numbers and a test; the capture size, the encoder ceiling and the
      SDP bitrate all come from it. One profile rather than the desktop's
      detail/motion pair - a phone shares its own screen, which is text far
      more often than it is film.

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
- [x] Clipboard, both directions, gated on `REMOTE_CLIPBOARD`. The phone's
      clipboard goes to the machine on a tap; what the machine has copied is
      *shown* rather than written onto the phone, because a machine that could
      overwrite the clipboard of the phone watching it whenever it liked could
      put a URL under somebody's next paste. Taking it is a second tap. The
      gateway is the one enforcing the permission - it refuses `clipboard.set`
      from a session without it in either direction - and the button is hidden
      rather than left to do nothing.
- [ ] File transfer, gated on `REMOTE_FILE_TRANSFER`. **Blocked, and not on
      this client:** there is no wire for it. The gateway has no file message
      in its vocabulary, the desktop agent has nothing that would receive one,
      and a remote session opens no data channel to carry it - see
      `remote-peer.ts`, which negotiates a video track and nothing else. The
      permission exists and does nothing on every client. Whoever adds the
      protocol adds this with it.
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
- [x] Input-sensitivity setting. **Was written down as blocked, and the
      reasoning was right about the two hooks it knew about.**
      `setSamplesReadyCallback` hands over a copy, after the buffer has gone to
      the encoder - good for a meter, useless for a gate. `setMicrophoneMute`
      zeroes the buffer *before* that copy is taken, so a gate driven from the
      meter would read its own silence the moment it closed and could never
      decide to open again: it latches shut. That trap is why "a level meter
      driving a mute toggle" was the honest description of what was available.

      `setAudioBufferCallback` is the third hook and it is the real one: the
      live capture buffer, in place, before it reaches the encoder. So the gate
      is a gate in the same sense the desktop's worklet is one - it measures the
      signal as it arrived and then attenuates the samples that are about to be
      sent, which is also what keeps it able to reopen.

      Same numbers as the desktop, so a threshold means the same thing on both:
      300 ms hold, 6 dB hysteresis, 5 ms attack and 150 ms release, ramped per
      sample because a buffer-wide gain step is audible as zipper noise. The
      settings screen draws the *pre-gate* level beside the slider - a meter of
      the gated signal would sit at silence exactly when somebody is trying to
      find the threshold that stops it doing that. It only moves during a call:
      Android does not reliably allow a second capture of one microphone, so the
      row says so rather than showing a bar that is dead for an invisible
      reason. `MicGateTest` covers the latching, the ramp and the sign.
- [ ] Theme: dark is the design. A light variant is open and the obstacle is
      the palette, not the taste - see phase 13.
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
- [x] Adding a friend to a server searches, rather than asking for a username
      typed exactly right and giving no sign which of the spelling and the
      feature was what failed. Friends-only, because the service refuses
      anybody else, and people already in the server are filtered out.
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

- [x] The refresh token is out of plain `SharedPreferences` and sealed by the
      Keystore, keyed per deployment - so a phone that has used two servers
      holds a token for each and switching cannot present one server's token to
      the other. A token written by an older build is moved on the first launch
      that finds it and the plaintext deleted.
- [x] Certificate handling for self-hosted deployments with a private CA:
      user-installed certificate authorities are trusted. Pinning needs a
      certificate known when the app is built and this app is built once for
      every deployment there will ever be; a trust-all override is not a
      certificate story at all. What is trusted is what the phone's owner
      installed, in Android's own settings, with Android's own warnings.
- [x] R8/ProGuard rules, shrink, and a release signing config. The environment
      supplies the keystore in CI; a `keystore.properties` beside the project
      supplies the same four values for somebody shipping from a laptop. Both
      are git-ignored, and with neither, `assembleRelease` produces an unsigned
      APK - which is correct: a signing key belongs to whoever ships the app.
- [x] Instrumented tests for the two things that outlive the process and cannot
      be checked on a JVM: the Keystore-sealed session (`SecureSessionTest`)
      and the server switch and the unsent-reply queue (`ServerSwitchTest`).
      Sending a message is not among them - it needs a deployment to send to,
      which is an end-to-end test and lives in `TESTING.md`.
- [x] Crash reporting, opt-in, and local. The stack trace is written to the
      app's own storage only when somebody has asked for it, and sharing it is
      a deliberate tap. No SDK: a self-hosted app phoning a service its
      operator did not choose is a strange default, and the report carries the
      stack, the Android version and the model - no account, no address, no
      token.
- [x] CI: `assembleDebug`, the unit tests and the instrumented tests compiled,
      on every pull request, alongside the existing pnpm jobs.
- [ ] A light theme. **Not started, and the reason is the palette rather than
      the design:** the ramp in `ui/theme/Color.kt` is forty top-level
      constants referenced directly by thirty-five files, so a second scheme
      means threading a palette through every one of them. It is open on the
      desktop and web for the same reason it is here - nothing about a light
      BetweenUs has been designed yet, and a half-converted theme is worse than
      none.

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

## Phase 15 — Auto update ✅ (compiles and is unit tested; never on a device)

There is no store in the loop. BetweenUs is self-hosted and its Android builds
are APKs attached to a GitHub Release by `.github/workflows/release.yml`, so
nothing tells a phone that a newer one exists unless the app does. It now does.

- [x] `feature/update/Releases.kt` — the rules, and all of them pure: a version
      parser for the shapes the release workflow produces (`1.2.3`,
      `1.2.3-alpha.4`, `1.2.3-beta.4`, with or without the `v`), which releases
      a channel may see, and which of a release's APKs belongs to this device.
      Anything it cannot parse is skipped rather than guessed at.
- [x] **Three channels, cumulative.** Stable takes finished releases; beta takes
      betas *and* stable releases; alpha takes everything. Cumulative is the
      point: somebody on beta who saw only betas would never be offered the
      stable release that supersedes the build they are running. The default is
      the channel the installed build came from - an alpha install asks for
      alphas - and it is changeable on the screen.
- [x] **"Newer" is by version, never by publish date.** A stable release cut
      after an alpha is not an upgrade for the person running that alpha, and
      dates say it is.
- [x] **The ABI-specific APK, not the universal one.** `Build.SUPPORTED_ABIS` in
      the device's own order, matched on the asset-name suffix so `-x86.apk`
      cannot match `-x86_64.apk`. The universal build carries every ABI's native
      libraries and is roughly three times the download; it is the fallback for
      a device whose ABI has no asset, and never the choice.
- [x] `feature/update/Updates.kt` — the state around the rules. The GitHub call,
      the APK streamed to the cache with progress, the snooze, and the hand-off.
      `SharedPreferences` and one `StateFlow`; six values do not need a
      database, and a `WorkManager` job would buy a background check nobody
      asked for. The check happens when the app is opened, which is the only
      moment an update can be acted on anyway.
- [x] **Nothing installs itself.** Android has no silent install for an app that
      is not the device owner, and it should not: the last screen is always the
      system's, showing what is about to replace what.
      `REQUEST_INSTALL_PACKAGES` is what lets the app reach that screen. From
      API 26 it is a per-app setting rather than a device-wide one and is *not*
      a runtime permission - it cannot be asked for with a dialog - so
      `Updates.canInstall` checks the grant and the settings page is offered
      instead of a prompt that would never appear.
- [x] **A `PackageInstaller` session, not an `ACTION_VIEW` intent.** Both end at
      the same confirmation dialog and the difference is what happens after it.
      The intent form is fire and forget, so the likeliest failure of the lot -
      `INSTALL_FAILED_UPDATE_INCOMPATIBLE`, an APK signed with a different key
      from the installed build - was a dialog that closed and an app that had
      not changed. The session answers to `UpdateInstallReceiver`, which starts
      the confirmation the platform hands back and says what went wrong when
      something does.
- [x] **The check runs on every launch**, once per process, from the shell. It
      is silent unless there is something to offer.
- [x] **And once a day while the app is closed.** `UpdateWorker`, a WorkManager
      `PeriodicWorkRequest` on unmetered network with the battery not low. The
      launch check reaches everybody who opens BetweenUs regularly and nobody
      else, and "nobody else" is exactly who a security fix has to reach: a
      phone that has not opened the app in three weeks is running a
      three-week-old build. It downloads nothing - that would spend somebody's
      storage on a decision they have not made - and draws one low-importance
      notification leading to the screen through `betweenus://update`. Enqueued
      with `KEEP` so an app opened daily still reaches the end of a period, and
      cancelled the moment the switch goes off: a switch that says "no" and
      leaves a daily job running is a switch that lied.
- [x] **Install or snooze.** The sheet has two answers, and the snooze defaults
      to one day (1, 3 or 7 on the screen). There is no "never" button: the
      version being refused is superseded next week, and a permanent refusal is
      what the switch on the screen is for.
- [x] `feature/update/AutoUpdateScreen.kt` — the switch, the three channels, the
      snooze length, a check-now button, and whatever the last check found. A
      screen rather than four rows in settings, because choosing alpha is
      choosing builds nobody has finished testing and that belongs beside the
      paragraph saying so. Reached from **Settings → Auto update**.
- [x] `ReleasesTest` covers the three decisions that install the wrong build
      silently when they are wrong: ordering across pre-releases, what each
      channel accepts, and which asset matches which ABI.

**What has not happened: any of it on a phone.** The four things to try first
are the install hand-off on a device where "install unknown apps" has never been
granted, an update across a channel change (alpha to stable, which must offer
nothing until the stable release passes the alpha), an install over a build
signed with a different key - which Android refuses, and which is the failure a
person sideloading their first release will hit, and now reports rather than
swallows - and the daily job, which is the one that cannot be watched: force it
with `adb shell cmd jobscheduler run -f com.aatech.betweenus <id>` rather than
waiting a day for it, and check that turning the switch off stops it.

## Sharing in, pasting in, and two things that were wrong on screen

Four items from a phone, in one pass.

- **BetweenUs is in the system share sheet.** `ACTION_SEND` and
  `ACTION_SEND_MULTIPLE` for media and documents land on `MainActivity`, which
  reads the URIs and leaves them in `PendingShare` - the shape `PendingChannel`
  and `PendingInvite` already use, because an intent is not a screen and cannot
  choose a conversation. `ShareTargetScreen` is what asks which one (see below),
  and the chat screen then takes the files into the same send preview a
  paperclip fills. So the flow is share sheet → pick a conversation → preview →
  send, and nothing is read, sealed or uploaded before somebody has looked at
  it. `text/plain` is deliberately not declared: a shared link belongs in the
  composer, and offering the app for something it would have nowhere to put is
  worse than not being offered.

- **The share asks where it is going.** The first version answered that itself -
  the channel that happened to be open, or the drawer if there was not one -
  and both readings were wrong from the sharer's side: the files either landed
  somewhere nobody chose or looked as though the app had swallowed them.
  `ShareTargetScreen` is WhatsApp's answer and now this app's: every direct
  message and every text channel in one searchable list, drawn over whatever
  was on screen rather than as a route, so a call in progress is not torn down
  to ask a question about a photo. Back cancels and drops the URIs, which is
  the only honest thing to do with a lend that nobody chose a home for.

- **A picture can be pasted into the composer.** Two paths, because there are
  two. The text field is a content receiver and consumes the image half of what
  the *keyboard* inserts - a Gboard sticker or GIF - handing it to the send
  preview rather than into the text; anything else in the same insertion still
  lands as text. A screenshot or an image copied from a browser is not that: it
  goes on the clipboard, where the text field's paste is text and Android does
  not offer Paste at all for a clip with no text in it, so there was no gesture
  that could send one. A clip holding an image now raises a bar above the
  composer with a **Paste** on it. Only the clip's description is read to decide
  whether to offer it - metadata, not content - and the picture itself is read
  when the button is pressed.

- **The call header no longer sits under the status bar.** A call hides the
  system bars, which takes their insets to zero, and `systemBarsPadding`
  faithfully reported nothing to keep clear - so the header slid up under a
  status bar that is still drawn over the app, transiently after an edge swipe
  and permanently on a device that declines to hide it. It uses
  `systemBarsIgnoringVisibility` now: how much room the bars take when they are
  there, whether or not they are there right now.

- **The message list follows the conversation again.** Three coroutines scrolled
  it: one on opening a channel, one on every new message, and the correction in
  `ChatScreen` that puts the view back on the bottom when a row grows
  underneath it. A `LazyListState` serialises scrolls through a mutex in which
  the newcomer cancels the incumbent, and being cancelled inside the
  correction's `collect` does not skip one scroll - it ends the collection, so
  the latch and the correction were gone for the rest of the channel. The first
  message sent could be the last one the list ever followed. The correction
  already covers the other two - a channel opening is a list whose end is off
  screen, a message arriving is a list whose end has moved past the bottom, and
  both leave a positive gap with the view still following - so it is now the
  only thing that scrolls, and it catches the cancellations that remain rather
  than dying of them. The rules themselves are unchanged in `Follow.kt`.

**None of the four has been on a device.** The share sheet is the one to try
first, and in three states: the app dead, the app in the background on a
conversation, and the app open on settings or a call. The second thing to check
is that reopening BetweenUs from the launcher afterwards does *not* re-share the
same photo - `singleTask` redelivers the intent that started the task, which is
why `EXTRA_STREAM` is removed once it has been taken.

---

## Calls & data, and adding somebody to a call ✅ (compiles and is unit tested)

Two holes that only existed on the phone:

- **The log was written with zeroes from here.** A phone said goodbye with no
  figures at all, so every call joined on Android read back as "no data
  recorded" - on the desktop too, since it is one log per account. `CallUsage`
  is the port of the desktop's arithmetic, per link, including whether ICE
  settled on a direct path or a relay; it goes out with the leave. A link's
  counters go with its connection, so the reading is taken as a peer leaves
  rather than asked for at the end.
- **There was no way to ring anybody.** `/api/v1/calls/ring` had no caller in
  this client. It is now a button in the dock, opening a sheet of everybody in
  the server who is not already here. Inside the call rather than in the member
  list: "who else should be here" is a thought somebody has while looking at a
  call, and a phone in a call is not showing a member list.

Settings gains **Calls & data**: the window, the chart, where the time went, and
the log with one row per connection behind each call.

**Not on a device yet.** Worth checking first: that a call taken on the phone
shows a real size on the desktop's page afterwards, and that ringing somebody
reaches a locked phone.

## The stage, after seeing it on a device

- **A landscape camera was cropped into a portrait screen.** `CallTile` defaults
  to `SCALE_ASPECT_FIT` now, so a phone and a laptop in the same call are
  looking at the same picture. `SCALE_ASPECT_FILL` is kept where a whole frame
  cannot be read anyway: the Android PiP window, the filmstrip thumbnails, and
  the self preview. The scaling type alone did nothing - it is read only in
  `onMeasure`, and the crop comes from the view's own aspect ratio - so
  `VideoSurface` sizes the surface to the frame instead of filling the tile.
- **The dock was seven buttons wide with 10dp between them**, the mic 4dp larger
  than its neighbours. Flip came out - it is on the self tile - and what is left
  is one size with room around it.

## Read receipts and swipe-to-reply ✅ (compiles and is unit tested)

Two things a phone chat is expected to have, and neither needed a new table or
a new wire beyond one GET and one socket event.

- **Who has seen it.** `Receipts` is the port of the desktop's `receipts.ts`,
  and `ReceiptsTest` is the port of its check - deliberately the same cases,
  because a phone that draws a face against a different message than the
  desktop does is two answers to one question. Up to four faces sit at the
  bottom right of your own messages, each reader shown once against the newest
  message they have read; tapping opens a sheet with the send time and each
  person's read time. `Conversation` loads the markers when a channel is opened
  and patches them from `channel.read`, replacing a person's marker rather than
  appending - it only ever moves forwards.
- **Swipe a row to reply.** Left to right, past 64dp so it cannot fire by
  accident, with the reply mark fading in underneath and a haptic at the point
  of no return. The release is a Material 3 expressive spring
  (`DampingRatioMediumBouncy`, `StiffnessLow`): the row overshoots and settles,
  which is what makes the gesture feel answered rather than merely undone.
  A tombstone does not swipe - there is nothing to answer.

`detectHorizontalDragGestures` is what keeps this out of the *list's* way: it
waits for horizontal touch slop, so a vertical drag still scrolls. What it did
not keep out of the way was the *left edge*, which two other things already
own: on a gesture-navigation phone a left-to-right swipe from the edge is Back,
and it is also the navigation drawer's. The first attempt at this turned the
drawer's swipe off inside a conversation, which was the wrong end of the
problem - it took the drawer away and the app still went back.

The edge is spoken for twice over, and the two claims settle differently.

**The drawer gets the edge.** On a gesture-navigation phone a swipe from the
edge is Back and the app never sees it, which is why the drawer would not open
by swipe at all. `Modifier.systemGestureExclusion()` is the only way to ask for
that area back, and `Shell` now holds a 24dp strip down the left edge that does
nothing but claim it. Android caps the answer at 200dp of height per edge and
keeps whatever is nearest the bottom of the screen, so the drawer opens by
swipe from the lower part of the edge - where a thumb rests - and Back still
works from the rest.

**The message gets everything else.** A drag starting within 48dp of the edge
is not the row's: nothing moves and nothing is consumed, so it reaches the
drawer or the system. Past that it is the row's and it consumes the drag, which
is what stops the drawer coming out underneath the reply. 48dp is inside the
bubble on every row - a grouped message starts at 56dp - so the gesture is
"swipe the message", which is where a thumb already is.

## Coming back from the background

A phone spends most of its life with the app away, and Android is free to drop
the socket while it is. Re-subscribing does not replay the gap - the server
sends what happens next, not what happened - so a conversation held open came
back several messages short, with a notification for each of them and nothing
in the list.

`Conversation.resumeVisible()` is the one answer to both moments: the activity
resuming (`AppForeground`) and the socket reconnecting (`ChatSocket.onReconnect`).
It re-reads three things that go stale together - the newest page merged over
what is held, the receipts, and the read marker. The refresh deliberately does
not touch the cursor, unlike `open`'s fetch: setting it from the newest page
would throw away how far back somebody had already scrolled.

The read marker used to move only when a channel was *opened*, which is why
"seen" needed the chat closed and opened again. A message arriving in the
channel on screen moves it as soon as it is drawn - gated on
`AppForeground.visible`, because the chat screen is still composed behind a
lock screen and nobody has read anything there. Ten messages landing at once
coalesce into one marker rather than ten POSTs.

## Deliberately out of scope

- **Live streaming.** Out of scope on every client while media is peer-to-peer.
- **An Android remote *agent*.** Controlling a phone is a different product.
- **An SFU.** If a call has to be bigger than a mesh can carry, that is a
  backend decision made once, for all clients, not an Android workaround.
