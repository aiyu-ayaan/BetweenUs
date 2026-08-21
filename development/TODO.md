# BetweenUs TODO

Ordered backlog. Check items off as they land; keep the "Next up" section at
the top honest — it is what a new session reads first.

## Next up

**Phase 27 - push notifications** is half landed. The device registry, the
`message.created` fan-out and the whole Android transport are in code and
documented in `FCM/`; a swiped-away phone is now reachable. What is still open
is Web Push, and the fan-out for remote sessions. The call half is answered by
`call.roster`, and Android rings from it: a direct call raises a full-screen
answer screen with the app dead. See the phase-27 section below.

**None of it has been in front of a human.** `FCM/TESTING.md` is the order to
try it in, and the four things most likely to be wrong are: the token arriving
at all, decryption in a cold process woken by a push, the suppression rule with
the screen locked, and the reply from the shade.

Everything else that was still open across web, desktop, Android and the backend
has been pulled into `TRACK.md`, which is the ordered list of what is being
built now; the phase sections further down are the record of how each area got
to where it is.

Phase 24 - peer-to-peer media - has landed in code. LiveKit is gone from the
repo, the deployment and the environment; calls and remote sessions are a
WebRTC mesh with `call-service` and `remote-gateway` as switchboards. Read the
phase-24 section of `PLANNING.md` first: it says why an SFU and a Cloudflare
Tunnel were never going to fit together, and the four commits before that phase
are all that one argument.

`pnpm typecheck`, `pnpm build` and `pnpm check` are green across the workspace,
and there is a mesh self-check covering the parts that fail silently - a
fingerprint check that wrongly *accepts* looks exactly like one that works.

**None of it has been in front of a human**, and the two cases that matter are
exactly the ones the old design failed: a call between two machines on
*different* networks, and a remote-desktop session through the tunnel. Two
clients on one LAN prove the least interesting case, because host candidates
connect without STUN, TURN or any of the machinery this phase is about. Until
somebody does that, treat phase 24 as unverified rather than done.

The container stack has still never been run end to end, which now matters more
rather than less: the compose file changed shape.

Phase 25 sits on top of it: the call now survives being navigated away from,
follows the account to whichever device joined last, and warns before a browser
tab carrying one is closed. It is also unverified in front of a human, and its
two cases are cheap to try - `pnpm dev:duo` plus a browser tab signed in as one
of the same accounts.

Phase 26 is the client's own look, and it is only paint and layout: no store,
no service and no protocol changed. It matters because the client was Discord's
palette and Discord's layout, hex for hex, which left BetweenUs with no way to
look like anything. Read the phase-26 section of `PLANNING.md` for the shape,
and "The workbench" in `TESTING.md` for what to click.

### The programme

The work chosen for this pass has its own document: **`TRACK.md`**. It is one
ordered list of what is being built now, what has landed, and what is left of
it, and it is deliberately narrower than this file - nothing joins it without
being chosen.

This file stays what it has always been: the record of how each phase got where
it is, and the backlog of everything anybody has thought of. Where an item
appears in both, the phase sections below carry the reasoning and `TRACK.md`
carries the state.

## Phase 27 — push notifications (Android landed, web and calls open)

Every client today only raises a notification while it is running. A closed tab,
a quit desktop app and a swiped-away phone are all unreachable, which is the one
gap that makes BetweenUs feel unlike the thing it is copying. It is also the only
remaining item that needs a service to grow a new surface, which is why it is a
phase of its own rather than a line in somebody else's.

The backend half is shared; the transports are per client. The registry, the
fan-out and the Android transport have landed; Web Push, calls and remote
sessions have not. **All of it is documented in `FCM/`** - the architecture in
`FCM/README.md`, the wire format and the order of the gates in
`FCM/PAYLOADS.md`, and what to try first in `FCM/TESTING.md`.

The rule the whole design turns on: **the push is data-only and carries no
words.** A message body is sealed with the channel key, so no service could
write a notification worth reading; and no service knows whether the recipient
is looking at that conversation right now. Both are decided on the device, which
is why a message arriving in the channel already on screen makes no sound - the
same behaviour WhatsApp has, for the same reason.

Backend (`notification-service`):

- [x] Device registry: `POST /api/v1/notifications/devices`
      `{ token, platform, deviceId, label?, appVersion? }`, `DELETE
      /api/v1/notifications/devices/:deviceId` on sign-out. One row per
      (user, device) - `DeviceToken` - keyed on the installation and not on the
      token, because a token rotates and a table keyed on it grows a row per
      rotation and then pushes at every dead one
- [x] The registration is bound to the account that made it: the token is
      unique across the table, so the same phone signing into a second account
      takes the row with it rather than leaving one behind, and `Session.signOut`
      unregisters *before* the tokens are discarded
- [x] Firebase credentials from the environment and never from a file -
      `FIREBASE_PROJECT_ID` / `FIREBASE_CLIENT_EMAIL` / `FIREBASE_PRIVATE_KEY`,
      or the whole key in `FIREBASE_SERVICE_ACCOUNT`. `pnpm firebase:env`
      converts a downloaded key. With none set, push is off and the service is
      otherwise unchanged
- [x] Fan-out on `message.created`, through the half of the predicate a server
      can answer: notifications off, a muted channel, a muted person. Quiet
      hours and mentions are the client's, because one is on the recipient's
      clock and the other is inside the ciphertext
- [x] Dead tokens deleted on `registration-token-not-registered` rather than
      retried forever
- [x] Never log a registration token
- [x] Fan-out for a call, as `call.roster` rather than `call.started`: the
      whole roster is what makes a notification that keeps up as people arrive
      and *goes away* when the last one leaves, which a "started" event cannot
      do. Android rings from it.
- [ ] Fan-out on `remote.session.started`

Web:

- [ ] A service worker and a Web Push subscription per device, stored in the
      registry above. What exists today is the Notifications API, which needs
      the tab open
- [ ] Tap-through into the channel, the call or the remote session

Android:

- [x] `google-services.json` handling: git-ignored, read from
      `apps/android/app/`, and the Gradle plugin applied only when it is there -
      so a clone without one still compiles and runs, with
      `BuildConfig.HAS_FIREBASE` false and nothing registered
- [x] Firebase Messaging and a `FirebaseMessagingService`; registered on
      sign-in, on session restore and on every `onNewToken`. Firebase is
      confined to one file (`feature/notifications/Push.kt`) and `:core` stays
      transport-agnostic behind `PushTokens`
- [x] Notification channels: messages and remote access, separate from the call
      channel `CallService` already owns, so one can be silenced alone
- [x] Foreground suppression: nothing for the channel already on screen -
      `AppForeground.visible && Conversation.visibleChannelId == channelId`.
      Both halves are needed; a locked phone still has the chat screen composed,
      so the visible-channel check alone silences a channel forever
- [x] The notification itself: `MessagingStyle`, one per channel, the sender's
      picture, direct reply from the shade (a broadcast, so it never opens the
      app), mark-as-read, a decrypted picture in the expanded view, and
      tap-through on `betweenus://channel/<id>`
- [x] Quiet hours and mentions applied on the device, which is the only side
      that can: one is the phone's own clock, the other is inside the ciphertext
- [x] `POST_NOTIFICATIONS` - already asked for at the first moment it means
      something, and the post is skipped when it is refused
- [x] Incoming-call UI raised from a push with the app dead. A `CallStyle`
      notification with a full-screen intent onto its own activity, which is
      what shows over a locked phone without giving `MainActivity` that
      property for every launch. Direct conversations only: a phone that rings
      for every call happening in a server it is in is a phone somebody turns
      notifications off on, and those keep the quiet notification

Desktop:

- [ ] Nothing. A running Electron app has the tray, and a quit one is out of
      scope until there is a reason to keep a process alive for it

Deferred alongside it, because it is the same "cache the thing the network gave
us" shape and nothing blocks it: caching attachment ciphertext next to the
message on Android, so an attachment opened twice is fetched once.

### Phase 26 — the workbench

- [x] `tailwind.theme.mjs`: BetweenUs's own ramp - cool near-black ink, iris accent
      `#7c5cff`, a `ground` darker than every panel, and `gg sans` gone from the
      font stack
- [x] `.panel` in `index.css`: one definition of a region, so rail, sidebar,
      main surface and right-hand panel cannot drift apart
- [x] `TopBar`: one bar across the window, the command field in the middle of
      it, and each layout toggle on the side it controls
- [x] `QuickSwitcher`: Ctrl+K over servers, the open server's channels and every
      conversation - the app's only global shortcut
- [x] The rail off the panel grid and onto the ground, with an accent bar at the
      left edge instead of Discord's morphing pill
- [x] Sidebar and right-hand panel hide from the top bar; the right-hand toggle
      is only rendered where a right-hand panel exists
- [x] `animate-pop` / `animate-fade`: one entrance for every dialog, menu and
      picker, and `active:` press feedback on buttons
- [x] Focus rings off text fields - the field's own edge and the caret say it
- [x] Sign-in, user settings and server settings on the same panels-on-ground
      layout as the workbench
- [ ] **Unverified in front of a human.** `pnpm typecheck` and `pnpm build` are
      green, which proves nothing about whether it looks right. See "The
      workbench" in `TESTING.md`.
- [ ] Light theme. The ramp is defined once now, which is what would make one
      possible; nothing else about it has been designed.

### Phase 25 — the call follows the account

- [x] `CallAudio`: every remote audio track mounted once at the root of the
      workbench, so switching servers or opening the home screen cannot unmount
      the call's ears
- [x] `stores/voice.ts`: the call's channel name and server recorded at join -
      `chat.channels` is per server, and a call outlives switching away from it
- [x] `VoicePanel` mounted in the home sidebar as well as the server one, with
      the channel name a button that loads that server and reopens the call
- [x] `leave(reason?)`: a call ended by something other than the user keeps the
      reason, where the old path set an error and then cleared it a line later
- [x] `call-service`: one call per account across devices - the other
      connections of that account are evicted on join, sent `superseded` first,
      and left open so joining again moves the call back
- [x] `shared-types`: the `superseded` server event
- [x] `mesh.ts`: `superseded` ends the call with "this call moved to another
      device" instead of "the connection was lost"
- [x] `call-service`: a self-check over the eviction scan (`devices.check.ts`) -
      the service's first, so `pnpm check` now covers it
- [x] Web: `beforeunload` while a call is up, so closing the tab asks first;
      desktop deliberately excluded
- [ ] **Unverified in front of a human.** Two devices on one account - the tab
      and the Electron window - joining the same call in turn, and a call left
      running while the client is driven around the app. See "A call that
      follows you" in `TESTING.md`.

### Phase 24 — peer-to-peer media

Signalling:

- [x] `call-service`: a `/ws/call` gateway - authenticated handshake, a peer id
      per socket (not per user: one account can have two windows), `START_CALL`
      checked on join, the roster sent to whoever joins, `peer.joined` and
      `peer.left` to everyone else, and verbatim relay of a signal addressed to
      one peer
- [x] `call-service`: the call-token endpoint returns ICE servers and nothing
      else - no URL, no room, no token, because there is no server to dial
- [x] `shared-types`: the `/ws/call` client and server event unions; delete
      `CallTokenResponse.url`/`token`/`room`
- [x] Nginx: a `/ws/call` location, WebSocket upgrade headers, no buffering
- [x] Vite dev proxy: `/ws/call` alongside the other sockets, so `pnpm dev`
      matches the deployment

The mesh:

- [x] `services/mesh.ts`: one `RTCPeerConnection` per peer, perfect negotiation
      with politeness decided by comparing peer ids, and a `betweenus.share` data
      channel per peer
- [x] Senders for microphone, camera, screen and screen audio, added and
      replaced in place so toggling a device does not renegotiate the world
- [x] Speaking detection from `getStats` audio levels - LiveKit's active-speaker
      event was doing this, and nothing else was
- [x] DTLS fingerprint signed with the channel key and verified on the far side,
      so the signalling server cannot put itself in the middle
- [x] `stores/voice.ts` rewritten on the mesh, keeping tiles, shares, the
      watched share, the mic gate and both quality modules

Everything that touched a LiveKit type:

- [x] `stores/shareControl.ts` on the data channel instead of `DataReceived`
- [x] `MediaSink`, `ShareStage`, `VoiceChannelView` take `MediaStreamTrack`
- [x] `VoiceChannelView` adaptive call grid: dynamic 1/2/4/6/9 layout scaling, uniform card dimensions, ambient blurred background for non-standard aspect ratios, and floating glassmorphism control dock
- [x] `share-quality.ts` and `voice-quality.ts` produce capture constraints and
      `RTCRtpSender` parameters instead of LiveKit publish options
- [x] Playout delay: `playoutDelayHint` on the receiver, which is what LiveKit's
      `setPlayoutDelay` was setting

Remote desktop:

- [x] `rtc.offer` / `rtc.answer` / `rtc.ice` on the remote wire types, relayed
      by `remote-gateway` between the two sides of one session
- [x] `remote-agent.ts` publishes the screen over a peer connection
- [x] `stores/remote.ts` receives it; `remote-gateway` stops minting tokens

Removal:

- [x] `livekit-client`, `livekit-server-sdk`, `livekit-check.ts`,
      `scripts/livekit-doctor.mjs`, `infrastructure/livekit/`
- [x] The `livekit` container, its compose entries, its tunnel ingress and the
      `/livekit` Nginx location
- [x] `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`,
      `LIVEKIT_NODE_IP`, and the LiveKit rules in `packages/config`'s check
- [x] The e2ee worker declaration and the insertable-streams plumbing

Proof:

- [x] A mesh self-check: politeness, glare, and a peer leaving mid-negotiation
- [x] `pnpm typecheck` and `pnpm build` clean across the workspace
- [ ] Two humans, two networks, one call: voice, camera, screen share, and
      asking for control of that share
- [ ] A remote-desktop session through the tunnel

Phase 23 - the web client - has landed in code: `apps/web` builds, typechecks
and mounts the same UI the Electron renderer does, with the remote-desktop
section gated behind the preload bridge. The image builds now too, and
`pnpm dev:web:lan` serves it to a second machine with calls that connect. What
it still needs is a browser in front of it and a human behind that: a call with
two people in it, a screen share, and asking a desktop client for control of
one. The container stack has still never been run end to end.

Phase 22 - the microphone: devices, noise suppression, an input-sensitivity
gate and two encoding modes - has landed in code and in a self-check. It has no
server side, so there is no smoke test; it needs two humans in a call, and one
of them needs a noisy room. Phase 21 - screen share encoding, so a film is
watchable and a desktop is sharp - has landed in code and in a self-check. Phase 20 - giving control of a
screen share inside a call, and named cursors on it - has landed in code and in
the geometry self-check. Neither has a server side and therefore neither has a
smoke test; both need two humans in a call.

Phases 17 and 18 have landed in code, in the smoke script and in CI; none of
the remote-desktop client side has been driven by a human, and no tunnel has
been stood up. Phase 16 landed before them and is in the same state, as is the
client side of 15b. Phases 13 and 14 landed earlier; what is left of them needs
a human in front of the app, and so does most of phase 12.

### Phase 23 — the web client

- [x] `apps/web`: a Vite bundle that mounts `apps/desktop/src/App` rather than
      copying it, with its own entry point, Tailwind content globs, dev-server
      proxy table, Nginx config and `pnpm dev:web` on 5175
- [x] `services/platform.ts`: one question - is the Electron preload bridge
      there - and the answer decides what a browser tab is offered
- [x] No remote-desktop section on the web: no machine list, no agent enrolment,
      no Remote Access settings. Requesting control of somebody's screen share
      inside a call is untouched and works from a browser
- [x] The bundle talks to the origin it was served from; `VITE_API_URL` is now
      only the fallback for a packaged renderer loading from `file://`
- [x] Its own image target and compose service, served at `/` by the gateway
      alongside `/admin`
- [x] Build the image. It had never been built, and it did not work: the build
      stage copies `apps/desktop/src` without a manifest on purpose - nothing
      there should install Electron - so the directory had no `node_modules`,
      and the web client compiles that source. Every bare import in it failed
      `TS2307` before anything real was reached. The stage links it to
      `apps/web/node_modules`, which declares the same set because it is the
      same UI. `web` was also missing from the images workflow, next to
      `admin-web`, which is how it reached a tag unbuilt
- [ ] Run the container stack end to end - the ten images build now, nothing
      has been driven through the gateway
- [x] A call from a second machine on the LAN. Signalling reaches the SFU
      through the dev server's `/livekit` proxy, but media does not go through
      a proxy and the candidates said `127.0.0.1`, so the other machine
      negotiated with itself until the client's 15s race called it "Connection
      to voice server timed out". `pnpm dev:web:lan` relays the SFU's ICE-TCP
      port from every address this host answers on, and the page rewrites those
      loopback candidates to the address it was loaded from. Nothing outside
      the repo is configured and nothing has to be put back - which is the
      point, since the alternative was mirrored networking plus a Hyper-V
      firewall rule
- [x] A call from outside the SFU's own network. `LIVEKIT_NODE_IP` makes the SFU
      reachable where it is reachable, and a self-hosted box behind a home
      router is reachable on its own network only - signalling arrives through
      the tunnel from anywhere, media negotiates to an address the outside world
      has no route to, and the call reaches "joined, no media" before the
      client's 15s race calls it a timeout. A Cloudflare tunnel cannot carry it:
      that is HTTP and this is WebRTC. call-service now mints short-lived
      Cloudflare TURN credentials and returns them with the call token, and the
      client passes them as `rtcConfig.iceServers`. It works with the SFU behind
      the NAT rather than the client because LiveKit runs a full ICE agent, not
      ICE-lite: the SFU sends its own checks to the client's relay candidate and
      opens the mapping from the inside. No port is forwarded and no LAN call
      changes - a direct path still wins the race whenever there is one
- [ ] Drive a call from a second network end to end, with the TURN key set. The
      code and its self-check have landed; nobody has yet joined one from off
      the LAN and heard the other side
- [x] Remote sessions get a relay too. The minting moved to `@betweenus/config`'s
      `iceServers()` with its own self-check, and `remote-gateway` hands the
      same short-lived credentials to both sides of a session that `call-service`
      hands to a call. Neither service names a media server any more, because
      phase 24 removed the one there was
- [x] Calls through the gateway at all. With `LIVEKIT_URL=/livekit` and every
      container healthy, a join still died with "Encountered websocket error
      during connection establishment": the `/livekit` block was not stripping
      its prefix, so LiveKit saw `/` and answered its root handler `200 OK`
      rather than upgrading. Every target in `nginx.conf` is a variable so the
      gateway starts before its services do, and that changes proxy_pass in both
      directions - a URI after a variable replaces the request URI outright, and
      no URI after a variable passes the original one, ignoring `rewrite`. A
      regex location building the upstream URI from a named capture is the form
      that works, and it needs `$is_args$args` or the access token is dropped
- [x] The container stack from a second device. A call joined from a phone on
      the network died with "could not establish signal connection: Failed to
      fetch" and `ERR_CONNECTION_REFUSED` on `127.0.0.1:7880`: the deployment's
      `LIVEKIT_URL` was still the host-development `ws://127.0.0.1:7880`, so
      every client was told to look for the SFU inside itself. A browser on the
      server does exactly that and connects, which is what let it pass testing.
      call-service and remote-gateway now compare the address with the caller's
      own `Host` header and answer `LIVEKIT_UNREACHABLE_URL` with the fix in it
      rather than handing out something undialable; the comparison is one pure
      function in `@betweenus/config` with a self-check, because both services had
      the same trap and only one had been reported. A container keeps the
      environment it was created with, so the error says to recreate the service
- [x] Watching a share from a browser. **Join stream** blanked the window - an
      empty dark page with nothing on it. The buttons over a watched share
      search the remote machine list; the web client's dev server does not proxy
      `/api/v1/remote` on purpose, and Vite answers an unproxied route with the
      app's own `index.html`. The API client turned that 200 into `null` and
      returned it as the array the caller had asked for, so the first render
      that searched it threw - and a render that throws unmounts React's whole
      tree, which is the blank page, with the cause three layers from anything
      visible. Fixed in three places, one commit each: a successful reply that
      is not JSON is an error naming the path, a browser tab does not ask for a
      machine list it will never show, and an error boundary below `App` turns
      the next such bug into a message instead of an empty window
- [ ] A human in a browser: log in, send a message, join a voice channel, share
      a screen (Chromium asks which one), ask a desktop client for control of
      its share and drive it
- [ ] Decide whether the shared UI moves to `packages/ui`. Worth a rename only
      if a third client appears; today it would change nothing else
- [x] Provider sign-in in a browser: the page redirects to the provider and
      comes back with the one-time code, using the `redirect` parameter the
      auth service checks against the deployment's own origins
- [x] Notifications in a tab: the Notifications API, permission asked at the
      first notification worth raising, and the unread count in the title -
      a tab has no tray and no dock
- [ ] Web Push, so a *closed* tab is still reachable. The above only works
      while the app is open; it needs a service worker and a push subscription
      stored per device in `notification-service`

### Phase 17 — remote desktop

- [x] `remote-gateway`: enrolment, per-machine grants, session lifecycle,
      `/ws/remote` relay and an append-only audit trail, on its own Docker
      network with Postgres and nothing else
- [x] `RemoteMachine`, `RemoteGrant`, `RemoteSession`, `RemoteAudit` with a
      migration, and `resolveRemoteAccess` as the single answer to "may this
      user do this to this machine"
- [x] Remote permissions granted per person per machine with an optional
      expiry, never by a server role; the permissions self-check asserts no role
      can produce one and the member editor cannot assign one
- [x] The agent lives in the desktop app: a switch in Settings → Remote Access
      enrols the machine, seals its token in the OS keychain, and dials out.
      Nothing listens on the machine and no port is opened
- [x] A session's permissions are frozen when it opens and the relay enforces
      them; a refused event is audited as well as rejected, and revoking a grant
      ends the session running under it
- [x] Screen over the same media path a call uses - no pixels through NestJS.
      Written against the SFU a call had then; since phase 24 it is one
      `RTCPeerConnection` straight from the agent to the controller
      (`services/remote-peer.ts`), and the gateway relays only the offer, the
      answer and the ICE candidates
- [x] Consent: the owner from another device starts immediately; anyone else
      raises a prompt on the machine that refuses itself if nobody answers, and
      a banner stays up for as long as the session does
- [x] Mouse and keyboard injection through a long-lived PowerShell process that
      P/Invokes user32 - no native module, no rebuild per Electron version
- [x] A machine list beside Friends, an Access dialog for handing out
      permissions with an expiry, and the machine's audit trail behind a tab
- [x] Control is a mode, not a permission: a session watches until control is
      taken, and Escape always hands it back. A session that was not granted
      control can ask for it the way RDP does, and whoever is at the machine
      answers - the one case where a person present outranks a stored grant.
      Lent control is written to the session row and audited, never to the grant
- [x] Clipboard sync both ways over `REMOTE_CLIPBOARD`, through Electron's own
      clipboard rather than the renderer's (which needs a permission this app
      denies), with the last value remembered so it does not loop
- [x] Fixed: control did nothing at all. The input helper was piped into
      `powershell -Command -`, which consumes stdin as the script itself, so the
      event stream and the program were the same pipe. It is a file run with
      `-File` now, its stderr is surfaced in Settings → Remote Access instead of
      being swallowed, and the numeric casts that threw on a scroll upwards
      moved into C#
- [x] Smoke coverage for the refusals and for the control handshake, in CI
- [x] Fixed: taking control made the pointer disappear. The video was given
      `cursor-none` on the assumption that the capture draws the machine's own
      cursor into the frame, which it does not reliably - so there was nothing
      left to aim with. It is a crosshair now, which says "this is going to the
      other machine" without ever leaving the user without a pointer
- [x] Fixed: clicks landed in the wrong place on a scaled display. Coordinates
      arrive as a fraction of the screen and were multiplied by the display's
      bounds, which are device-independent pixels; `SetCursorPos` wants real
      ones, so at 150% scaling a click two thirds of the way across the screen
      landed at the far edge. `screen.dipToScreenPoint` does the conversion,
      which also keeps it right for a display that is offset as well as scaled
- [x] Resolution follows the display instead of a preset, RustDesk-style. The
      agent asks the main process for the primary display in real pixels and
      publishes at that size with `contentHint: 'text'`, no simulcast, and
      `degradationPreference: 'maintain-resolution'` - a remote desktop that is
      sharp at a low frame rate beats a blurry one at thirty. The bitrate
      ceiling is derived from the pixel count (4 Mbps at 1080p, clamped to
      12 Mbps) rather than fixed, and LiveKit still backs off on its own when
      the link cannot carry it
- [x] The controller subscribes with `adaptiveStream` off. It sizes the
      subscription to the video element, so a session in a window smaller than
      the machine's screen was downscaled by the SFU and stretched back up -
      which is what made the picture soft whatever the agent published. Moot
      since phase 24: there is nothing between the two machines to resize
      anything, so the controller receives what the agent sent
- [x] The agent shares the *primary* display rather than the first screen the
      capturer happens to list, because the primary display is the one input is
      injected into. On a two-monitor machine those were different screens
- [x] "Open a session" on somebody's screen share in a voice channel, for a
      machine this account already has standing access to: a shortcut past the
      machine list, never past the grant or the consent prompt. A live session
      is drawn over the whole window now instead of inside the machine list,
      which is what lets it be started from anywhere
- [x] The controller picks which monitor. The agent sends `screens` when a
      session opens and after every swap; the controller answers with
      `screen.select` and the gateway relays both. No permission of its own - a
      session allowed to see the screen may know how many there are, and a
      view-only session is entitled to look at the second one. `remote:target`
      moves input to the same display in the same breath as the capture starts,
      or a controller watching the second monitor clicks on the first

Left open on purpose:

- [ ] Input injection is Windows-only. macOS (CGEventPost) and Linux (XTEST or
      uinput) are a backend each behind the same three-function interface
- [ ] `REMOTE_FILE_TRANSFER` and `REMOTE_AUDIO` exist in the vocabulary and do
      nothing: no file transfer, and the agent publishes no audio
- [ ] Clipboard sync is text only and polled once a second - there is no
      reliable clipboard event on any platform. Files and images through a
      clipboard are a transfer mechanism, which is the file-transfer permission's
      job rather than this one's
- [ ] A remote session has no application-layer encryption of its own, unlike a
      chat message - there is no channel key to reuse and no key exchange
      between two machines that never spoke. Since phase 24 there is no SFU in
      the path, so the frames are DTLS-SRTP between the two machines and the
      operator's servers never see them; a configured TURN relay forwards
      encrypted packets it cannot read. What is left is that the *signalling*
      server introduces the peers, so a malicious gateway could try to sit in
      the middle - which is exactly what the call path's fingerprint check
      defends against and the remote path does not do yet (`E2EE.md`, limit 10)
- [x] The display list follows the machine for the whole session: Electron's
      own `display-added` / `display-removed` / `display-metrics-changed` are
      broadcast to the renderer (coalesced by half a second), the agent re-reads
      its displays and re-sends `screens`, and a monitor unplugged while it was
      the one being sent falls back to the primary display
- [x] Sessions are relayed through Redis Pub/Sub, so the agent and the
      controller need not land on the same instance. Every message goes out
      through one pair of methods that deliver to a local socket when this
      replica holds it and publish when it does not; an instance drops its own
      publications, so nothing is delivered twice. Which machines have an agent
      connected is a Redis key with a TTL rather than a map in one process, so
      "that machine is not connected" is an answer about the deployment - and a
      replica that dies stops claiming its agents by itself. A controller's live
      permissions are read from the session row when the socket is elsewhere;
      the in-memory list is a cache of that row, kept in step by
      `control.changed` on its way past
- [x] `machineForAgentToken` is one indexed lookup. The constant-time compare it
      replaced was defending a value with no structure to leak - a SHA-256 of a
      256-bit random token - and costing a full table read per agent reconnect
- [x] Ended sessions and old audit rows are swept daily -
      `REMOTE_SESSION_RETENTION_DAYS` (30) and `REMOTE_AUDIT_RETENTION_DAYS`
      (365). A session with no `endedAt` is never swept, whatever its age
- [ ] `apps/services/remote-agent` is still a scaffold. A headless server has no
      BetweenUs window to run the agent inside, and that is what it is for
- [x] The controller sends what it was holding with every key event, and the
      machine reconciles its modifiers to it, so a chord arrives as a chord.
      It also self-heals: a modifier released while the controller's window
      was not focused is let go on the next key rather than staying down.
      Windows still reserves Ctrl+Alt+Del itself - no injected input can
      raise the secure attention sequence, and nothing here pretends to
- [ ] Quality is set once at the display's size and left to LiveKit's
      congestion control from there. There is no manual quality picker and no
      "balanced / sharp / smooth" choice the way RustDesk offers, and nothing
      raises the frame rate back up once a link recovers faster than the
      encoder notices

### Phase 22 — a microphone worth listening to

A voice channel published LiveKit's defaults: 48 kbps mono, whatever processing
the browser felt like, the system's default device, and no way for anybody to
change any of it. Fine on a headset in a quiet room and audibly worse than
Discord anywhere else - a fan, a keyboard or a flatmate came along with the
voice, and somebody with two microphones could not say which one. The numbers
and the reasoning live in `apps/desktop/src/services/voice-quality.ts`, the gate
in `mic-gate.ts`.

- [x] Noise suppression asks for `voiceIsolation` as well - Chromium's
      model-based suppressor, which is the nearest thing to Discord's Krisp
      that ships with the runtime. Where it exists it replaces
      `noiseSuppression`; where it does not, an unknown constraint is ignored,
      so asking costs nothing and never fails a capture
- [x] An input-sensitivity gate, which is what actually makes a Discord call
      silent between sentences: suppression cleans up a signal, it does not
      decide that nobody is talking. It runs in an AudioWorklet, so it is not
      throttled when the window goes to the background and it can act between
      samples rather than on a 100 ms poll, which is what would clip the first
      consonant of every sentence. 5 ms to open, 150 ms to close, a 300 ms hold
      through the gap between words and a 6 dB hysteresis band so a voice on
      the line does not chatter it
- [x] The worklet is assembled from `stepGate`'s own source rather than a copy,
      so the logic under the self-check is the logic on the audio thread
- [x] Two modes rather than a quality slider, the same shape as the screen
      share picker: **clear** is 64 kbps mono with speech processing and DTX,
      **high fidelity** is 128 kbps stereo with none of it - every one of those
      is destructive to anything that is not a voice, and DTX deletes a held
      note outright
- [x] Input and output device pickers, stored per machine rather than per
      account: the microphone that suits this room is not the one that suits
      another. A device that has been unplugged falls back to the default
      instead of failing the join. The same two lists sit behind a button on
      the call controls, because the moment somebody wants them is the moment
      they cannot be heard
- [x] Fixed: "Audio context needs to be set on LocalAudioTrack in order to
      enable processors", and no microphone at all. A processor passed in the
      capture options is applied inside `createLocalTracks`, before the room's
      audio context reaches the freshly created track, so it always threw and
      took the publish with it. The gate is attached after the track is
      published now, on a context this window owns, and a failure there loses
      the gate rather than the microphone
- [x] Switching mid-call costs whatever it has to and no more: a threshold is a
      message to the audio thread, the three processing switches are
      `applyConstraints` on the open track, and only a new device or a new mode
      republishes
- [x] "Let's check" opens the microphone on its own with a live meter, so a
      threshold can be set without being in a call
- [x] `voice-quality.check.ts` covers both modes, the constraint objects, the
      gate's three behaviours and the worklet splice, in CI

Left open on purpose:

- [x] Push to talk, in `services/push-to-talk.ts`. It switches `enabled` on the
      raw capture rather than republishing, so a key held for a syllable costs
      nothing and the gate downstream keeps its worklet. Still open: it only
      works while the window has focus. Electron's `globalShortcut` cannot fix
      that - it reports a press and never a release, and a microphone that
      cannot be told the key came up is worse than no push to talk at all. A
      native keyboard hook per platform is the whole of the remaining work
- [x] Per-person volume and mute, in the voice panel. Not sent anywhere and not
      shown to them: it is this machine's opinion of how loud somebody is.
      Capped at their original level, because that is `HTMLMediaElement.volume`'s
      ceiling - boosting past it needs a WebAudio gain node in the path
- [x] Measured now: `services/call-stats.ts` samples every peer connection
      every two seconds, the connection panel shows it, and a microphone that
      is sending nothing raises a warning in the call itself rather than waiting
      to be looked for
- [ ] The gate is level-based, not a voice-activity model. A door slamming
      opens it; Discord's does the same, but Krisp's does not
- [ ] The meter opens a second capture of the same microphone rather than
      tapping the live one. Windows is happy to do that; a platform that is
      not would show a dead meter during a call
- [ ] Output device selection depends on `setSinkId`, and the *system* default
      is followed only until a device is chosen - nothing notices when Windows
      changes its default afterwards

### Phase 21 — a screen share worth watching

LiveKit's default screen share is 1080p15, about 3 Mbps, simulcast on, VP8, and
whatever jitter buffer the browser felt like. Sensible for showing somebody a
spreadsheet over a bad line; unwatchable as a film and barely usable as a
desktop. Every number below is the thing that was wrong, and all of them live
in `apps/desktop/src/services/share-quality.ts` with the reasoning.

- [x] The picker asks what is on the screen rather than guessing. **Text and
      detail** keeps resolution and gives up frames; **video and motion** does
      the reverse at 60 fps. Neither is "better quality" - they are opposite
      trades, and picking the wrong one is what "the quality is bad" usually
      turns out to be
- [x] Fixed: stopping a share from the browser's own "Stop sharing" bar left
      everyone else on a black stage with the sharer's name on it, and no way
      off it but leaving the call. Nothing was listening for the capture ending
      anywhere except this app's own button, so the publication stayed up with a
      dead track behind it. The published track's `ended` now runs the same stop
      the button does, and the stage additionally drops `watching` whenever the
      person being watched stops sharing - two independent cures, because the
      second one holds for a sharer that crashed rather than stopped
- [x] Fixed: in a browser the "Share system audio" checkbox was ours, disabled,
      and a lie - only the surface picker can offer a tab's audio or the
      system's, and it only offers either when the capture asked for audio in
      the first place. A browser share now always asks, so that choice appears
      where the surface is chosen, and the checkbox is desktop-only where this
      app really is the one doing the capturing
- [x] Fixed: a viewer opened somebody's share, watched a still screen for five
      seconds, and was dropped back to the grid with the share offered again.
      Whether a peer was sharing was answered by counting decoded frames, and a
      screen nobody is touching decodes none - so every quiet moment read as
      the share ending. Frames now only ever say a slot has *started* carrying
      a picture; whether it is still on is the sender's own media state, which
      every client already published on the data channel and no client read for
      anything but the microphone. Desktop, web and Android all had it
- [x] Bitrate scales with pixels instead of being one low number: 6 Mbps at
      1080p for detail, 24 for motion, clamped at both ends. A ceiling, not a
      target - a still desktop spends a fraction of it and congestion control
      lowers it the moment the link says so
- [x] Simulcast off. It divides the budget three ways so a weak viewer can be
      sent a small stream, and then lets the SFU hand somebody the bottom layer
- [x] H.264, because it is the one codec with a hardware encoder on every
      Windows machine and therefore the one that can do 1080p60 without melting
      a CPU. VP9 and AV1 look better per bit and are encoded in software, which
      costs exactly the latency this is buying
- [x] `setPlayoutDelay`: near zero for anything being driven, two frames for
      anything being watched. The default jitter buffer is where a third of a
      second of latency lives, and taking control of a share re-tunes it
- [x] Capture asked for at the display's real pixel size, so a 1440p or scaled
      screen is not captured at 1080p and stretched back up
- [x] A shared soundtrack keeps both channels, full-band stereo Opus, and none
      of the speech processing - gain control pumps, noise suppression eats
      reverb tails, and DTX cuts the quiet passages of a film out altogether
- [x] The remote desktop publishes through the same profile ('detail'), so
      there is one set of numbers rather than two
- [x] `share-quality.check.ts` covers the bitrate arithmetic and both profiles,
      in CI

Left open on purpose:

- [ ] No manual override. There is no "use 20 Mbps" box and no way to force a
      codec, so a LAN cannot be told it is a LAN. Parsec's whole trick is
      knowing that; this only ever infers it from congestion control
- [ ] Motion is capped at 48 Mbps, so a 4K film can still be limited by the
      link. The cap is about links, not screens
- [x] Measured now. Bitrate, frame size, frame rate, loss and round trip are in
      the connection panel in the call controls, so "it looks bad" and "the link
      is bad" are different sentences without opening
      `chrome://webrtc-internals`
- [ ] If a machine has no hardware H.264 encoder the fallback is software
      H.264, which is worse per bit than the VP8 it replaced. Nothing detects
      this or switches back

### Phase 20 — giving control in a call

Helping somebody in a call is not the same problem as reaching a machine, and
was being made to use the machinery for the other one. Enrolling a machine and
writing down a grant beforehand is right for "I administer that box"; it is
absurd for "you can see my screen, you drive". Teams calls the second one
giving control, and this is that.

- [x] The whole exchange rides the voice room's own data channel between the
      two clients. No gateway, no enrolment, no stored grant. The only
      authority is the person sharing clicking yes - which is the right one:
      it is their machine, they are sitting at it, and they can see what is
      being done with it
- [x] Checked on every event rather than once at the grant: the sender is the
      identity control was given to (since phase 24, the peer id `call-service`
      assigns to a socket after it has authenticated it, so it cannot be
      claimed), a screen is still being shared, and
      that share is a whole display. Control of a *window* is refused outright
      - a window can be dragged between monitors, so there is no fraction of a
      screen to map a click onto
- [x] It ends when the share does, when the room does, when that person leaves,
      when either side presses the button, and when the driver presses Escape.
      Escape never travels, for the same reason it does not in a remote session
- [x] A prompt the sharer has to answer and a banner that stays up for as long
      as somebody else is driving, both above the whole app - a machine being
      driven by another person is not a background event
- [x] Named cursors, Teams-style: everybody watching a share sends where their
      pointer is over the picture and sees everyone else's with a name on it.
      Only one person can drive; anybody can point, which is most of what
      pointing at a screen share is for
- [x] Cursors and clicks are fractions of the *picture*, not of the element it
      is drawn in. A desktop is letterboxed rather than cropped, so those are
      two different rectangles whenever the aspect ratios differ, and the black
      bars are not part of anybody's screen. `stage-geometry.check.ts` is the
      arithmetic, in CI

Left open on purpose:

- [ ] Windows only, like every other input injection here
- [ ] No audit trail. A remote session writes every refusal to the machine's
      history; this writes nothing anywhere, because there is no server in the
      path at all. The banner and the prompt are the whole record
- [x] One input target per source, not per process: a remote session and control
      handed out in a call each keep their own display, so a machine doing both
      at once no longer points both at whichever was set last. Held modifiers
      are tracked per source for the same reason
- [ ] A pointer is sent to everyone in the room, watching or not, and dropped
      by clients that are not looking at a share. Fine at call sizes
- [x] Modifier chords, through the same reconciliation the remote path uses -
      one module, two callers. The held modifiers ride on every key event

### Phase 18 — production ingress

- [x] Cloudflare Tunnel both ways round: one already running on the host adds a
      single ingress entry pointing at `GATEWAY_PORT`, or `--profile public`
      brings a container. `infrastructure/cloudflare/tunnel.yml` documents both
- [x] The gateway has a healthcheck, and the tunnel container waits on it
      rather than on the container merely existing
- [x] Image pipeline: one job per service pushing to GHCR on a tag or by hand,
      so a deployment pins something built once

Left open on purpose:

- [x] Media through the tunnel was the gap this phase left, and phase 24 closed
      it by removing the thing that needed a port: there is no SFU, so no
      `7881/tcp` and no UDP range have to be reachable. Media is peer to peer
      and ICE finds its own path; a deployment behind a NAT that no direct path
      survives configures TURN, which is outbound-only from both peers
- [ ] Secrets are environment variables read from `.env`. No Docker secrets, no
      external secret manager, no rotation
- [ ] Nothing deploys: the images are built and pushed, and putting them on a
      machine is still manual
- [ ] No TLS between Cloudflare and Nginx (the tunnel is the encrypted hop) and
      no way to run Nginx with a certificate of its own

### Phase 16 — one address, any server

- [x] One base address for a whole deployment, read at runtime from
      `services/endpoint.ts`: REST, `/ws/chat`, `/ws/presence` and the stored
      files all hang off it, and nothing else in the client knows a host
- [x] `VITE_API_URL` is the only variable left and is only a default;
      `VITE_WS_URL` is gone (it was that URL with a different scheme), and Vite
      reads the repo-root `.env` so it sits beside the ports it agrees with
- [x] "Connect to a self-hosted instance" on the login screen, AFFiNE-style: an
      address is normalised (bare hostname means https, trailing slash goes, a
      path is kept) and probed before it is stored, so a typo is a line under
      the field
- [x] The same dialog on My Account, so the server is changeable at any time;
      switching signs the window out and reloads
- [x] Avatars and server icons resolved against the deployment instead of
      `file://`, which is what they did in a packaged window before
- [x] Nginx proxies `/livekit` to the SFU and `LIVEKIT_URL` may be that path, so
      voice needs no second hostname; the client resolves a path form itself
- [x] The renderer's CSP stopped naming hosts: `script-src` stays `'self'`,
      `connect-src` and `img-src` are open, because an allowlist compiled into
      the app cannot know an operator's hostname
- [x] `endpoint.check.ts` covers the address parsing, in `pnpm check`

Left open on purpose:

- [x] WebRTC media needing its own ports was true while there was an SFU, and
      is not any more: phase 24 made media peer to peer, so one hostname covers
      everything the deployment has to serve. TURN on 443 is the fallback for a
      pair of networks with no direct path, and it is optional
- [ ] No list of recent servers - one address is remembered, not a history
- [ ] The admin panel still reads its own `VITE_API_URL` at build time; it is
      served from the deployment it administers, so it has never needed more
- [ ] Nothing checks that the deployment's version matches the client's; a
      client too old for a server finds out through a failing request
- [ ] E2EE device keys are stored per user id, not per (server, user id), so
      two deployments that hand out the same id would share a key entry

### Phase 15b — what you can do to a message

- [x] A deleted message leaves a tombstone in the conversation: *Message
      deleted*, or *Message deleted by NAME* when a moderator removed somebody
      else's. `deletedById` stored, body still emptied
- [x] Edit your own message (`PATCH /api/v1/messages/:id`), with an *(edited)*
      marker; the author only, never a moderator
- [x] Right-click menu on a message - react, edit, pin, copy, delete - replacing
      the hover bin, with the two-click arming kept for delete
- [x] Pins: `PUT`/`DELETE /api/v1/messages/:id/pin`, `GET /api/v1/messages/pins`,
      a `MANAGE_MESSAGE` permission for server channels and no permission at all
      inside a direct message
- [x] Pinned panel in the right-hand column; clicking a pin scrolls the
      conversation to that message and flashes it
- [x] Search panel in the same column, over the history this window has
      decrypted, with a footer saying how far that reached
- [x] Reactions: `POST /api/v1/messages/:id/reactions` toggling one emoji,
      chips under the message with counts, yours highlighted
- [x] An emoji picker used by both the composer and a message, from a curated
      set in the repo rather than a dependency
- [x] One `message.updated` event for every after-the-fact change, carrying the
      whole message
- [x] The blue focus ring is gone: a thin neutral ring for keyboard users, and
      none at all on text fields
- [x] Smoke coverage for all of it, including the three fanouts on a live socket
- [x] Fixed: an unread badge that never cleared. A message arriving in the
      channel already on screen while the window was in the background was
      counted, and only opening a channel cleared a count - so it stayed.
      Regaining focus now marks the open channel read, and a message arriving in
      a focused open channel moves the account's marker too
- [x] A red "New" divider above the first unread message, placed from the read
      marker as it stood when the channel was opened, and clearing itself five
      seconds after its messages have been read rather than waiting for the
      channel to be reopened
- [x] Fixed: Chromium's own blue focus outline survived on a server pill;
      `:focus { outline: none }` plus no ring at all on the rail pills
- [x] A refused menu action reports its reason in the conversation, and Pin is
      shown disabled with the permission it needs instead of being absent
- [x] Fixed: a granted permission never reached the member it was granted to.
      Their client reads permissions from the server list it fetched at
      sign-in, so a grant only took effect after a restart. `server.member.updated`
      now fans out like the added and removed events and the client re-reads

Left open on purpose:

- [ ] No edit history, and no way to see what a message said before - the
      envelope is replaced, so the old text is gone from the database too
- [ ] Reactions are plaintext (`E2EE.md` limit 9); an encrypted reaction needs a
      key exchange per thumbs-up
- [ ] Search only reaches what this window decrypted, and does not page further
      back on its own; the footer says so rather than hiding it
- [ ] No "who reacted" tooltip on a chip - the user ids are there, the names are
      not fetched
- [ ] The pinned panel caps at 100 pins and does not page
- [ ] The unread line does not survive a restart: the marker does, but the line
      is only placed when a channel is opened in this session
- [ ] Pinning in a server channel is `MANAGE_MESSAGE`, so a plain MEMBER cannot
      pin until an administrator grants it. Whether a small server wants that
      gate at all is worth revisiting
- [ ] No "jump to the first unread" button on the line, and no unread bar at the
      top of the channel
- [ ] A tombstone stays forever; nothing sweeps rows whose body has been empty
      for months. Their attachment blobs do go - `AttachmentSweeper` collects
      what a deleted message no longer justifies - but the empty row stays

### Phase 15 — the social graph in realtime

- [x] Delete a message: `DELETE /api/v1/messages/:id`, the author always and
      anyone else with `DELETE_MESSAGE`; a soft delete that empties the body, so
      history paging keeps its cursor and the ciphertext stops existing
- [x] A bin on hover in the client, armed by the first click and fired by the
      second — no modal for a one-line message
- [x] Add someone to a server by username from the members screen
      (`POST /api/v1/servers/:id/members`, `MANAGE_MEMBER`), joining as a
      MEMBER; adding someone already in it returns them unchanged
- [x] The members screen searches the same user directory the friends screen
      does, and leaves out anyone already in the server
- [x] `/ws/chat` grew the events the social features need: `message.deleted`,
      `friends.changed` and `server.members.changed`, with user rooms for
      what is addressed at a person and server rooms for what is addressed at a
      community; a `server.subscribe` is membership-checked like a channel one
- [x] Friend requests, acceptances, removals and a newly opened conversation
      reach the other side without a reload
- [x] A client watches every server it is in, so being added or removed lands
      wherever it is looking; being removed from the open server closes it
- [x] Smoke coverage: the permission rules above, plus a second socket asserting
      all three fanouts and a refused `server.subscribe`

Left open on purpose:

- [x] An attachment's blob goes when its message does; the sweep phase 13 left
      open now exists, and a destroyed channel or server reaches it too - the
      row's `messageId` goes null, which is the same case as an unsent upload
- [ ] An added member gets no notification, only a server that appears; there
      is no invite to accept or decline
- [ ] `server.members.changed` makes the client re-read the member list, so a
      busy server refetches on every join and leave

### Phase 14 — notifications, the tray and auto-start

- [x] `notification-service` as its own deployable package: preferences and
      read state on the account, a gateway route, a compose service and a
      `dev:duo` health warning
- [x] Per-channel mute (a bell in the channel header) and quiet hours, stored
      on the account rather than in one client
- [x] Unread state persisted as a read marker per channel, so a badge survives
      a restart and follows the account; loaded at sign-in, cleared on open
- [x] Do Not Disturb actually enforced, alongside the mute, the quiet hours and
      the account switch, in one predicate every notification path goes through
- [x] System tray: unread-aware tooltip, click to restore, Quit on its menu,
      and closing the window hides to it so notifications keep arriving
- [x] Start with the system, on by default, with a switch in settings; a
      development window never registers it
- [x] Single-instance lock, so launching the shortcut again means "come back"
- [x] Smoke coverage: preference round trip, unread counting, history from
      before joining not counted, and an unreadable channel answering 404

Left open on purpose:

- [ ] Nothing raises a notification while the client is signed out or the
      machine is asleep - that needs a push transport (APNs / FCM / Web Push),
      which is what a web and Android client will want anyway
- [x] A mention is distinguished from an ordinary message, and a channel can be
      set to mentions only. The client decides what a mention is - `@username`,
      `@display name`, `@everyone`, `@here` - because it holds the only
      plaintext there is; the account stores which channels are set that way
- [ ] Unread counts are one query per channel; a single grouped query if a
      busy account makes that show
- [ ] The tray icon is a data URI in the main process, not a real asset, and it
      does not follow a light or dark system theme
- [ ] Decrypted history is cached in memory per channel, so it is gone after a
      restart. Persisting it means encrypting it at rest with a device key -
      worth doing, not free
- [ ] The channel and member lists are refetched on every server switch; the
      same "paint what is known, refresh behind it" trick would fit

### Phase 13 — media

- [x] Attachments encrypted under the channel key before upload, with the
      manifest (name, real type, size, nonce, epoch) inside the encrypted
      message body rather than in columns
- [x] Any file type, because the server never learns what it is; served as
      `application/octet-stream` with a download disposition, always
- [x] Client-side compression before encryption: oversized photos redrawn to
      1920px webp, text-shaped files gzipped through `CompressionStream`
- [x] Multipart upload for anything over 8 MB, with the session held as a
      sealed ticket the client carries instead of state in a service
- [x] Attach from a picker, a drag and drop, or a paste; chips with sizes and
      per-file upload progress
- [x] Images inline at their stored dimensions, text files previewed with an
      expand, everything else a card with a download; full-size overlay
- [x] A message over 2000 characters is sent as `message.txt` with a preview
- [x] Avatars and server icons: square-cropped and rescaled in the client,
      uploaded in the clear, settable only to a picture this deployment stored
- [x] Server icons rendered in the rail (`iconUrl` existed and nothing used it)
- [x] Smoke coverage: byte-for-byte round trip, part ordering, ticket bound to
      its account, scratch space not downloadable, SVG refused as a picture,
      foreign avatar URL refused
- [x] Fixed: sharing system audio put the call into an echo. Windows loopback
      captures the machine's whole output mix, and that mix includes the voice
      channel coming out of the speakers - so a share re-broadcast everyone in
      the room back at themselves a beat late. The capture asks for
      `restrictOwnAudio` now, which leaves this app's own output out of it: the
      film's soundtrack travels, the voices in the call do not. Microphone
      capture also spells out echo cancellation, noise suppression and gain
      control rather than leaving them to the browser default

- [x] Fixed: attachments worked in development and failed in the container
      stack. The services run as uid 1000 and the upload volume mounts at
      `/data/uploads`, a path no image stage created - so Docker invented the
      mountpoint itself, root-owned, and every write returned `EACCES` while
      the rest of chat-service behaved normally. The runtime stage creates it
      owned by `node`, which an empty named volume inherits on first use. A
      host path in `UPLOAD_DATA_PATH` is never seeded from an image and still
      has to be chowned once; the compose file says so where it is set

- [x] Fixed: a channel of photos would not stay at the newest message, on any
      client. Attachments are ciphertext until they have been fetched and
      decrypted, so a row is laid out at one height and grows to its real one a
      moment later - and "following the conversation" was defined as "the end of
      the list is near the bottom of the screen", recomputed whenever anything
      moved. Growth therefore *un-followed* the list, and the correction written
      to handle growth read the flag growth had just cleared. It is a latch now,
      released only by the reader scrolling up: `follow.ts` on desktop and web,
      `Follow.kt` on Android, the same cases and a test on both sides. The
      desktop also watched only the message list, so it survived a picture
      arriving and not the viewport getting shorter underneath a composer that
      had grown a preview

- [x] Fixed: Android re-decrypted every picture it scrolled past. A
      `LazyColumn` disposes a row as it leaves the screen, and the row was where
      the decrypted bytes, the decoded bitmap and the video's file all lived -
      so coming back to a photo downloaded, decrypted and decoded it again, and
      a video wrote another copy of itself into the cache directory each time.
      `MediaCache` is the phone's version of the blob `Map` the desktop has
      always had in `services/attachments.ts`, bounded to an eighth of the heap
      and emptied on sign-out. Android's uploader also recorded no pixel size,
      which is what every client reserves an attachment's space from, so a photo
      sent from a phone was the one attachment that jumped on every client

Left open on purpose:

- [x] An attachment's blob goes when its message does. Every upload writes an
      `attachments` row; a message claims the keys it carries when it is sent,
      and `AttachmentSweeper` deletes the object and the row once the message
      is deleted - or, for an upload nobody ever sent, once
      `ATTACHMENT_GRACE_HOURS` (24) has passed
- [x] `sweepStaleMultipart` runs every six hours on the local driver, clearing
      scratch directories untouched for `UPLOAD_SCRATCH_MAX_AGE_HOURS` (12).
      S3 is deliberately left to its own `AbortIncompleteMultipartUpload`
      lifecycle rule, which is one line of bucket configuration and a better
      answer than walking a bucket from the application
- [ ] An attachment is sealed in one operation, so the client holds the whole
      file in memory; chunked AEAD would lift the 100 MB ceiling
- [ ] No video transcoding — a large video is sent as it is. Doing it properly
      means ffmpeg in the client
- [ ] Two humans exchanging a file: sent from one machine, opened on another
- [ ] An attachment sent before someone joined a private channel is unreadable
      to them, the same way its messages are; key rotation has the same gap
- [ ] `restrictOwnAudio` is a recent Chromium constraint and an unsupported
      runtime ignores it silently, in which case the echo is back and
      headphones are the only cure. Per-process loopback capture (the Windows
      `ActivateAudioInterfaceAsync` application loopback API, which is what
      Discord uses) is the version that cannot be ignored, and it needs a
      native module

### Phase 12 — servers, permissions and direct messages

- [x] Rename workspace to server: Prisma models `Server`, `ServerMember`,
      `ServerRole` with a migration, `/api/v1/servers`, `server-service`, and
      every reference in the client, compose files, Nginx, CI and dev scripts
- [x] Per-member permission overrides on `ServerMember` (granted / denied) on
      top of the role defaults, and one `resolveChannelAccess` in
      `@betweenus/database` replacing the copies in chat-, call- and
      presence-service
- [x] Server settings API: change a member's role, grant and revoke individual
      permissions, kick a member, rename or delete the server
- [x] Private channels: `Channel.isPrivate` and a `ChannelMember` allowlist,
      chosen when the channel is created, honoured by listing, history, calls,
      presence and the E2EE key wrapper
- [x] Friends: search users by name, send, accept and decline requests, remove a
      friend
- [x] Direct messages: `Channel.serverId` nullable, `DM` channel type, the two
      participants as channel members, opened only between accepted friends
- [x] Active status: online, idle, do not disturb, invisible — chosen in the
      client, stored in Redis, and resolved to offline for everyone else when it
      is invisible
- [x] Discord-parity client: colour tokens, server rail with a home button that
      opens direct messages, channel sidebar, grouped message list, member list
      on the right, DM screen
- [x] Global settings overlay: my account, profile, voice and video,
      notifications, appearance, log out
- [x] Server settings screen: overview, roles and permissions, members,
      channels, invites, delete server — no events, no boosting
- [x] Remove the E2EE badge from the channel header
- [x] `dev:duo` seeds a friendship, a direct message and a private channel; the
      smoke scripts assert private-channel denial, a permission override, a
      friend request and DM delivery

Phase 12 opened these, and left them open on purpose:

- [x] Rotate the channel key when someone is dropped from a private channel's
      allowlist, so removal takes future messages away and not only the listing.
      Their key still opens what was sent before - a key on somebody's machine
      cannot be taken back - and opens nothing after
- [x] Editing a private channel's allowlist from the UI. Server settings →
      Channels → "Who is on it" on any private channel; removing somebody
      rotates the key immediately, so what is said afterwards is sealed with a
      key they do not have
- [x] Invite codes with an expiry, a use limit and a revoke, instead of a
      permanent server slug. `POST/GET/DELETE /api/v1/servers/:id/invites`,
      `MANAGE_MEMBER` to mint one, and `POST /servers/join` takes a code - the
      slug is a name now and opens nothing
- [x] Custom named roles with a colour and an ordering, on the backend.
      `GET/POST/PATCH/DELETE /api/v1/servers/:id/roles`, assigned through
      `roleIds` on the member editor. Additive on top of the five built-ins
      rather than replacing them - the built-ins are the hierarchy, and a
      hierarchy anyone can extend is a hierarchy anyone can climb - and a
      member's denials still beat every role they hold. The permission editor
      draws them too: a server's roles are created, coloured, ranked and given
      their capabilities on the Roles screen, held roles are toggled per member,
      and the member list wears the colour of the highest-ranked one
- [x] Idle status set automatically after a period of no input, rather than only
      by hand. Ten minutes, from the operating system's own idle clock on the
      desktop and from the tab's events in a browser; Android still only sets a
      status by hand

### Carried over

- [ ] Two humans in a voice channel: audio actually heard, camera, screen share
      (both clients hold a mesh connection per peer and send opus over
      DTLS-SRTP; nothing about it has been heard by a person)
- [ ] Watch a typing indicator land in the UI
- [x] Per-user rate limit on login, not only per client address. A botnet spread
      across addresses used to get 20/min each against one account; login is now
      counted in two buckets, and the account's is 10/min however many addresses
      the attempts arrive from
- [ ] Sign in with Google or GitHub end to end against real provider apps
      (the flow is wired and the panel stores credentials; nobody has run it
      through a real Google or GitHub client yet)
- [ ] Admin panel served through the gateway container path (verified in dev on
      5174, not yet through `admin-web` behind Nginx)
- [x] OAuth sign-in for the admin panel itself. The login screen draws a button
      per provider the operator switched on and comes back to the panel's own
      origin with a one-time code; the administrator check is the same one the
      password path uses, so signing in correctly is still not the same as
      being let in here
- [x] Audit log of admin actions - who disabled or deleted whom, and when. One
      row per thing that actually changed, and the target is stored as a label
      as well as an id, because the action most worth auditing destroys the row
      the id points at
- [x] Pagination in the users table. A cursor rather than an offset: the list is
      newest first and registrations keep arriving, so an offset would show the
      same account at the end of one page and the start of the next

## Done

### Phase 1 — dev infrastructure
- [x] `docker-compose.dev.yml` with Postgres + Redis only, bound to localhost
- [x] `.env.example` covering every variable the MVP reads

### Phase 2 — shared packages
- [x] `@betweenus/shared-types` — DTOs, API contracts, WebSocket event types
- [x] `@betweenus/config` — typed env loading
- [x] `@betweenus/logger` — structured JSON logger with redaction
- [x] `@betweenus/auth` — JWT sign/verify, Nest `JwtAuthGuard`, `@CurrentUser()`
- [x] `@betweenus/permissions` — role and permission constants
- [x] `@betweenus/events` — event names and payload contracts, Redis publisher
- [x] `@betweenus/database` — Prisma schema + client singleton

### Phase 3 — auth service
- [x] `POST /api/v1/auth/register`
- [x] `POST /api/v1/auth/login`
- [x] `POST /api/v1/auth/refresh` with rotation
- [x] `POST /api/v1/auth/logout`
- [x] `GET /api/v1/auth/me`
- [x] `GET /health`

### Phase 4 — server service
- [x] Create / list servers, owner membership on create
- [x] Create / list channels, membership-checked
- [x] `GET /health`

### Phase 5 — chat service
- [x] `GET /api/v1/messages?channelId=&before=` history paging
- [x] `POST /api/v1/messages` send
- [x] `/ws/chat` WebSocket gateway with JWT handshake auth
- [x] Redis Pub/Sub fanout so multiple instances stay in sync
- [x] `GET /health`

### Storage
- [x] `@betweenus/storage` with local-disk and S3 drivers, chosen from env
- [x] `POST /api/v1/uploads` and `GET /api/v1/uploads/:key` in chat-service
- [x] Key generation, traversal guard, content-type allowlist, inline/attachment
      disposition rules
- [x] Attachment model on `Message` so uploads attach to a message — one row per
      uploaded blob, claimed by the message that carries it (the client names
      the keys on send, because the manifest inside the body is sealed)
- [ ] Avatar upload wired to the user profile
- [x] Orphan sweep for uploaded objects never referenced by a message — the same
      six-hourly sweep that collects the blobs of a deleted message; an
      unclaimed upload goes after `ATTACHMENT_GRACE_HOURS` (24)

### Phase 6 — gateway
- [x] Nginx REST + WebSocket routing, rate limiting, body size limits
- [x] Production `docker-compose.yml` with per-network isolation

### Phase 7 — desktop client
- [x] Electron main + hardened preload (contextIsolation, no nodeIntegration)
- [x] Vite + React + Tailwind + Zustand renderer
- [x] Login / register screen
- [x] Server + channel sidebar, create dialogs
- [x] Message list with realtime WebSocket updates

### Phase 8 — encrypted chat and voice
- [x] `@betweenus/shared-types` contracts for envelopes, device keys, channel keys
      and call tokens
- [x] `device_keys` + `channel_keys` Prisma models and migration
- [x] `/api/v1/e2ee` in chat-service: device directory, channel-key publish and
      fetch, epoch ordering and holder rules
- [x] Desktop E2EE: ECDH P-256 identity per device, HKDF key wrapping,
      AES-256-GCM messages, self-check covering the primitives
- [x] Private keys sealed with Electron `safeStorage` through IPC
- [x] `call-service`: LiveKit access tokens, membership-checked, `/health`
- [x] LiveKit container, `livekit.yaml`, Nginx routes, compose wiring
- [x] Desktop call UI: participant tiles, mic/camera/screen toggles, E2EE media
      via `ExternalE2EEKeyProvider` (join aborts rather than downgrades)
- [x] Screen-share capture handler in the Electron main process
- [x] `pnpm dev:duo`: two seeded users, two Electron profiles, one dev server
- [x] `development/E2EE.md` and `development/TESTING.md`

Follow-ups this phase deliberately left open:

- [x] Rotate the channel key (epoch + 1) when a member is removed
- [x] Account portability: the identity key is sealed with PBKDF2 over the
      account password (or a recovery passphrase) and stored in
      `identity_backups`, so a reinstall or a second machine restores the same
      key instead of minting one that cannot read anything
- [ ] Multi-device proper: a key list per user, one wrap per device, so a
      device can be revoked without rotating the account identity. What exists
      today copies one identity to every machine
- [ ] Let a user rotate their identity (and re-seal current channel keys for
      the new one) after a device is lost
- [ ] Identity verification UI (safety numbers) so a lying server is detectable
- [ ] Encrypt attachments with the channel key too
- [x] Screen-share source picker instead of always taking the primary screen:
      screens and windows with thumbnails, plus a system-audio option on Windows
- [ ] Secure context for packaged builds, so E2EE media works outside dev

### Phase 9 — presence and voice channels
- [x] `presence-service` with `/ws/presence`, Redis-backed online set, voice
      rosters and typing fanout over Redis Pub/Sub
- [x] Online dots in a member list, "is typing" above the composer
- [x] Voice channels Discord-style: `VOICE` channel type in the sidebar, click
      to join, roster visible without joining
- [x] Removed the per-text-channel call button
- [x] Voice panel: participants, mic/camera/screen toggles, disconnect
- [x] Join no longer fails when the machine has no microphone
- [x] Single-flight token refresh (concurrent refreshes were killing sessions)
- [x] `LIVEKIT_URL` on `127.0.0.1`: Chromium tries `::1` first and the container
      publishes IPv4 only
- [x] `dev:duo` seeds a voice channel, skips the login screen, and mirrors
      renderer errors into the terminal
- [x] CSP allows the LiveKit origin - its signal handshake starts with an HTTP
      fetch, which `connect-src` was blocking, plus `worker-src blob:` for the
      encryption worker LiveKit creates
- [x] Leaving a voice channel clears the roster on every path, not only the
      button: a kick, a drop or a crash reports it too, and presence-service
      heals a drifted roster on join and on first connect
- [x] Joining a channel you are already in is a no-op (it used to open a second
      session and get the first kicked for duplicate identity)
- [x] A hot reload hands the Room back before the module is replaced
- [x] Microphone, camera and screen-share failures report their real reason and
      no longer read as a failed join
- [x] LiveKit client debug logging in development, mirrored to the terminal
- [x] Voice channel screen in the main content area: participant tiles with
      camera/screen video, an empty state with a Join Voice button, and controls
      under it. The first click on a voice channel joins, later clicks only
      reopen the screen. Video left the sidebar panel
- [x] A shared screen is its own stage, not a replacement for the sharer's
      camera tile: others get a "NAME is sharing" banner with Join stream, which
      opens a theatre layout - screen large, faces on a strip underneath
- [x] Grid pages at nine tiles with pager arrows, and recent speakers are pulled
      to the front so an active speaker is on page one. Speaking is amber
- [x] Fixed: no one could join a call under `pnpm dev`, and the guard written to
      explain exactly that was the thing that stayed silent. call-service asks
      the SFU whether it accepts a token this deployment signs, and it only ever
      asked `http://livekit:7880` - a name that resolves inside the compose
      network and nowhere else. With the services on the host that check failed
      to connect every time, which is *not* the same answer as "rejected", so
      the status stayed `unknown`, tokens were minted, and the SFU threw them
      out at the point of connection. Development is where a container most
      often outlives the `.env` value it was created with, so it was the one
      mode that needed the guard and the one mode that never had it. Both
      addresses are tried now, whichever answers wins, and `livekit-doctor`
      names the compose file the SFU is really running under instead of always
      quoting the production one
- [x] Fixed, and behind the same symptom: the dev SFU advertised its own bridge
      address in its ICE candidates. Signalling goes through the published port
      and worked, so a join got a token, opened the socket, started an RTC
      session - and then waited for media on `172.24.0.4`, which Docker Desktop
      and WSL2 do not route the host to. The client's own 15s race was the only
      thing that ever spoke up, as "Connection to voice server timed out". The
      dev compose file passes `--node-ip 127.0.0.1`, overridable with
      `BETWEENUS_LIVEKIT_NODE_IP` for a second machine on the LAN

### Phase 10 — hardening
- [x] Move `livekit/livekit-server` to v1.13.5 in both compose files. v1.7
      predated `SessionDescription.id`, so the client never saw its publisher
      offer acknowledged and every publish failed with "negotiation timed out".
      Keep the tag in step with `livekit-client` in `apps/desktop`
- [x] Refresh-token reuse detection (revoke whole token family on replay)
- [x] Rate limit login/register at the service level, not only in Nginx
- [x] Unit tests for `AuthService` (register/login/refresh) with a Prisma mock —
      `pnpm --filter @betweenus/auth-service check`, in-memory database
- [x] Presence smoke test: two sockets, sync/typing/voice/offline asserted
- [x] Integration test: register → create server → create channel → send
      message (`chat-service/smoke.mjs`, now exits non-zero on a failed assert)
- [x] Promote both smoke scripts into CI as integration tests
- [x] GitHub Actions workflow: install → lint → typecheck → build → self-checks,
      plus an integration job with Postgres and Redis service containers
- [x] Request id assigned at bootstrap and logged with every completed request,
      with the authenticated user when there is one
- [x] Verify the Nginx gateway path and container builds end to end — needed a
      `migrate` service in the production compose file and OpenSSL in the images

## Backlog (later phases)

### Security follow-ups
The API audit landed in phase 27 — see `SECURITY.md` for what it fixed. These
are the gaps it left open deliberately, in the order they matter.

- [ ] Revocation that reaches a live socket. Disabling an account stops new
      sessions and stops a refresh being spent, but a chat or presence socket
      already open keeps delivering until it disconnects. Expiring sockets at
      the access token's expiry is the wrong fix — a call socket closing is a
      call ending. Wanted: a revocation event on Redis the gateways subscribe
      to, dropping the sockets of an account that was disabled or signed out
- [ ] Refresh replay grace in Redis rather than a per-process map. Until then,
      more than one auth-service instance reads a legitimate replay that landed
      on the wrong one as theft and signs the account out
- [ ] A sliding rate-limit window. Fixed windows let a burst straddle two of
      them and take twice the budget for a moment; a sorted set is the upgrade
- [ ] Sniff a picture's magic bytes rather than believing its declared content
      type. Contained today — the download route derives the type from the key's
      extension and sends `nosniff`, so a mislabelled file downloads rather than
      renders — but the upload still stores whatever it was handed
- [ ] Validate remote input events in the agent. The gateway checks the
      permission an event type requires and forwards the event unread, which is
      the right split; the agent is what has to decide a coordinate or a key
      code is sane, and does not yet

### Presence follow-ups
- [x] Idle status, automatic as well as chosen
- [x] Scope presence broadcasts instead of sending every event to every socket.
      `presence-service/src/audience.ts` answers who may hear about a user and
      who may hear about a channel; the smoke script now carries a third account
      that shares nothing and must receive nothing. Left open: the cache is a
      30-second TTL rather than an invalidation, so a membership change takes
      that long to be reflected
- [x] Server-authoritative voice rosters. `call-service` holds the signalling
      sockets, so it is the authority: it publishes `call.roster` and
      presence-service applies it whole. `voice.join` over `/ws/presence` still
      answers the permission question and no longer writes anything

### Phase 11 — admin panel, OAuth and notifications
- [x] `GlobalRole`, `mustChangePassword`, `disabledAt`, `UserIdentity` and
      `OAuthProvider` in the schema, with a migration
- [x] `pnpm admin:create` (and `--reset`): bootstrap admin, password printed once
- [x] `/api/v1/admin`: status, user directory with search, promote/demote,
      disable/enable, delete, OAuth provider config
- [x] Guard rails: last administrator cannot be removed, demoted or disabled;
      no self-demotion or self-deletion; disabling revokes live sessions
- [x] Account endpoints for every user: change password, change username and
      display name
- [x] `apps/admin`: bootstrap gate, login, forced password change, users table,
      provider config, own-account page
- [x] Google and GitHub sign-in: server-side code exchange, one-time code to a
      loopback redirect, provider buttons that appear only when configured
- [x] Client secrets sealed at rest, never returned by the API
- [x] Desktop notifications for messages and voice joins, with unread counts,
      taskbar flash and click-to-open

### Phase 19 — what a deployment still needs
- [x] TURN so voice, screen share and remote desktop survive a pair of networks
      with no direct path. `@betweenus/config` mints short-lived Cloudflare TURN
      credentials and both `call-service` and `remote-gateway` hand them out;
      it is off until an operator configures a key, which is the intended
      default
- [x] One data path per deployment. `pnpm data:path /srv/x/betweenus` creates
      `data/postgres`, `data/redis`, `data/media` (`pictures/`, `attachments/`)
      and `backup/`, chowns the uploads tree to uid 1000, and writes the four
      bind paths into `.env`. Compose interpolates one variable per mount, each
      defaulting to the named volume it always used, so a deployment that never
      runs the script is unchanged. Media is not split into `image/`/`video/`:
      attachments are encrypted in the renderer, so the server never learns what
      they are
- [x] Automatic database backups. `db-backup` dumps gzipped plain SQL every
      `BACKUP_INTERVAL_HOURS` (weekly by default, `BACKUP_KEEP` retained), and
      `db-backup-once` dumps immediately before `prisma migrate deploy` with
      `migrate` waiting for it to succeed - so a migration on a deployed
      database cannot go first. `pg_dump` runs from the postgres image so client
      and server versions match. Restore is `psql` and nothing else
- [ ] Backups leave the host. The dumps sit next to the database they came from,
      which covers a bad migration and not a dead disk; shipping them off-box is
      the operator's own job today
- [ ] Secret management beyond `.env`, and rotation
- [ ] Something that actually deploys the images the pipeline pushes

### Cross-cutting debt
- [ ] Split the shared Prisma schema into per-service schemas
- [ ] Replace Redis Pub/Sub with NATS when fanout volume needs it
- [x] Custom named roles with a colour and an ordering, alongside the five
      built-ins plus per-member overrides phase 12 shipped. The desktop and web
      permission editor draws and assigns them; the Android one does not yet
- [ ] `user-service` (profiles, avatars, friends): those routes are served by
      chat-service today
