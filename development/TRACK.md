# BetweenUs — the current track

One ordered list of the work accepted for this pass, kept apart from `TODO.md`
so that document can go back to being what it is: the record of how each phase
got to where it is, and the backlog of everything anyone has ever thought of.

This is narrower. It is the set of items chosen to be built now, and nothing
else joins it without being chosen. **Push notifications joined it** - the
device registry, the `message.created` fan-out and the Android transport are
below; Web Push and the call and remote-session fan-outs stay in phase 27 of
`TODO.md`, unchosen.

Ticked here means: landed in code, `pnpm typecheck` and `pnpm check` green, and
a self-check where the logic had somewhere to hide. It does not mean a human has
seen it - see "Nothing here has been in front of a human" at the bottom, which
is true of every line of it.

---

## Landed

Listen Together:

- [x] **A shared music queue inside a voice call**, on `/ws/call`. A session is
      a queue, a cursor and a position stamped against the gateway's own clock;
      `call-service` orders the presses and broadcasts the whole session, and
      nothing is persisted - it dies with the call.
- [x] **No audio crosses the wire.** Each client plays the track itself, from
      YouTube, over its own connection. This is the entire reason the feature
      exists rather than being "screen share with the sound on": a share is one
      upload per listener, music through a codec meant for speech, and the
      sharer pinned to a tab. A timestamp costs nothing and is better in every
      one of those.
- [x] **A position that stays true between messages.** The session stores where
      the track was *and when*, so a client that has heard nothing for ten
      minutes is still in step. The arithmetic lives in `shared-types`, imported
      by both sides, because a gateway that advanced it differently from the
      clients reading it would be a session where nobody is wrong and nobody
      agrees.
- [x] **A clock measured the way NTP does.** `pong` carries `serverMs`; the
      client keeps eight samples and takes the least-delayed one rather than the
      average, because a slow round trip is biased and not merely noisy.
- [x] **Drift left alone below 1.5s**, then closed in one seek. The textbook
      `playbackRate` nudge is not used and cannot be: the YouTube embed
      quantises rate to its own menu, so 1.04 is refused or rounded to 1.25.
- [x] **No host.** Anybody may add, skip, seek, pause or stop. `rev` on every
      change, and a client drops anything numbered at or below what it has
      already applied, so its own echo cannot undo somebody else's later press.
- [x] **`listen.ended` from every client, advancing once.** Idempotent by
      checking the track id rather than by electing a reporter - electing one
      means the queue stops when that person's window closes.
- [x] **`listen.meta` for the title.** A pasted link has none, and nothing on
      the server may go and ask: that would be a backend service with an API
      key, an egress rule and an opinion about who is listening to what. The
      clients have the player open; first one to know fills it in, and a later
      client claiming a different title is ignored.
- [x] **No YouTube script in the renderer.** `script-src` stays `'self'`. The
      embed is driven over the postMessage protocol `iframe_api.js` wraps, in a
      sandboxed cross-origin frame with no `allow-same-origin`, and the only
      directive that changed is `frame-src`. Origin and source are both checked
      on every incoming message.
- [x] **Music ducks under whoever is talking**, faded, held for the gap between
      sentences, driven by the call's existing speaking detection - so a muted
      person in a noisy room does not turn anybody's music down.
- [x] **The real youtube.com, inside the call, on desktop.** Pasting links was
      the wrong shape: nobody keeps a list of video ids, they search for a half
      remembered chorus or open a playlist they made, and two of those need a
      signed-in account. A `WebContentsView` the main process owns, in its own
      `persist:youtube` partition, with no preload and navigation confined to
      Google's hosts. Not `webviewTag`, which would give the renderer the power
      to mount web content anywhere; not an iframe, which youtube.com refuses
      outright - so the web client keeps the paste box and is told why.
- [x] **Press a video, the call watches it.** No link, no button: landing on a
      video page inside the browser plays it for everybody and flips the panel
      to the player. A button that queued whatever page you were on was still a
      paste box with the copying moved indoors; clicking a thumbnail is the
      gesture people already have for "play this". Only on a change and only
      after the first navigation report, or reopening the panel on the page
      somebody left it on would restart the room's track. Underneath it is
      `playNow` on `listen.add`, and the gateway jumps to the new track inside
      the same action - not an add followed by a play, because two messages are
      two revisions and anything arriving between them moves the index the play
      was aiming at. **Add to queue** stays for the other thing, which is
      choosing what comes after what is on, and still leaves you on the site.
- [x] **The browser is not a second player.** A watch page autoplays, so
      clicking a thumbnail left the site playing the same song a few seconds out
      from the shared one, with its own controls and nobody's agreement. Muted
      on build and on every show - the mute belongs to a page that may since
      have navigated through a sign-in - and nothing plays in it at all:
      `media-started-playing` pauses whatever started. Pausing after a
      navigation was four races - the watch page's autoplay, an SPA click with
      no load event, the next video after one ends, a play button pressed by
      hand - and it lost some of them; that event is the one place all four
      arrive. Muting alone was never enough either: a muted video is still
      decoded and downloaded, for a picture nobody chose. That half of the panel
      picks; the shared player plays.
- [x] **A transport that says what *this* window is doing.** The play/pause
      button was drawn from the session, so a window refused permission to start
      its audio showed `pause` while playing nothing: pressing it paused the
      track for everybody, pressing it again played it for everybody, and the
      silent window stayed silent. Blocked now draws play, in amber, with "press
      play here" beside the title, and the click starts this window rather than
      driving the room. The prompt used to live in the panel body, which meant
      it did not exist at all once the panel was closed.
- [x] **A seek that stopped snapping back.** Letting go of the bar cleared the
      scrub value and showed the position from the session as it was, until this
      client's own request had been to the gateway and back - so every seek
      jumped home and then forward a round trip later, which reads as "it did
      nothing" and reads worst for whoever is furthest away. The released
      position is held until a higher `rev` arrives, with a two-second timeout
      for the answer that never comes; losing pointer capture or focus commits
      the drag rather than stranding the thumb.
- [x] **The video on screen.** Both the player's frame and the browser's view
      follow the same rule: the thing that plays outlives the component that
      shows it. A React component offers an empty rectangle and the frame is
      positioned over it, because a frame destroyed on unmount is a fresh
      player - back at zero, refused autoplay, out of step with the room.
- [x] **The bug that made all of it silent.** `sandbox` without
      `allow-same-origin` gives a frame an opaque origin, so every message it
      posted arrived as `origin: "null"` and the origin check refused all of it.
      Handshake never completed, `playVideo` never flushed, player visibly
      present and permanently mute with nothing in the console. The sandbox
      bought nothing - a cross-origin frame is already isolated exactly as hard.
      Alongside it: `origin=file://` is refused by YouTube, which would have
      broken a packaged build while the dev server worked.
- [x] **Two self-checks**: the transport state machine (which found a real bug -
      re-stamping always makes a new object, so the "nothing changed" identity
      test never fired and every late metadata report bumped the revision) and
      the clock, the tolerance and what a pasted link is allowed to become.

Backend:

- [x] **Per-account login rate limit.** A second bucket keyed on the account
      being tried, 10/min, so a botnet spread across a thousand addresses shares
      one budget aimed at the password rather than getting 20/min each.
- [x] **Automatic idle.** Ten minutes with no input, back on any. The OS idle
      clock on desktop, the tab's own events in a browser; a call counts as
      present, a chosen status is never overwritten.
- [x] **Scoped presence.** A status reaches people sharing a server or a
      friendship; anything about a channel reaches people who can see it. The
      sync at connect is filtered the same way.
- [x] **Server-authoritative voice roster.** `call-service` publishes
      `call.roster`; presence-service applies it whole. A client can no longer
      put itself in a channel it never signalled into.
- [x] **Mentions-only per channel.** The bell cycles all / mentions / none.
      Detection is the client's, because bodies are sealed with the channel key.
- [x] **Channel-key rotation on removal.** `rekeyNeeded` is derived by comparing
      who holds the epoch with who is a member now; the first holder to sync
      mints the next epoch.
- [x] **Invites.** Codes with an expiry, a use limit and a revoke. The slug is a
      name and opens nothing.
- [x] **Retention.** Finished remote sessions after 30 days, audit rows after a
      year, abandoned multipart uploads every six hours.
- [x] **Agent-token lookup.** A unique index instead of a full table scan on
      every agent reconnect.
- [x] **Custom named roles with a colour and an ordering.** A table, a rank, a
      colour, and a permission bundle, additive on top of the five built-ins
      rather than replacing them. A member's denials still beat every role they
      hold. The desktop and web editor draws and assigns them - see below;
      Android's does not.
- [x] **Remote sessions over Redis Pub/Sub.** The agent and the controller no
      longer have to be on the same replica. One pair of methods carries every
      message - local socket when this instance holds it, Pub/Sub when it does
      not - and which machines have an agent connected is a Redis key with a TTL
      rather than a map in one process.
- [x] **Attachment blobs swept when their message is deleted.** Every upload
      writes an `attachments` row; the client names the keys it is sending, so
      the message claims them without the server reading the sealed manifest.
      The sweep collects a blob whose message has been deleted at once, and an
      upload nobody ever sent after a day.
- [x] **Admin: audit log, paged users table, OAuth for the panel.** The trail is
      append-only and keeps a label for a target that no longer exists; paging
      is a cursor, so a registration between two requests cannot repeat a row;
      the panel's own login now offers whichever providers are switched on.

Security, and the scan that found the rest of it:

- [x] **Adding a member is friends-only.** `POST /servers/:id/members` looked a
      username up and added it - any account on the deployment, by anybody
      holding MANAGE_MEMBER, with no relationship required. Being added is not
      passive: it is a member list entry, a notification and a set of readable
      channels, none of which the person was asked about. A pending request is
      not a friendship, or "ask and add anyway" would be the way past the check.
- [x] **A moderator cannot edit or kick an administrator.** The permission
      check answered "may you manage members at all" and the role check
      answered "may you hand out that role"; neither asked who the member was.
      Equal ranks are refused as well as higher: two administrators editing each
      other is a fight, not a hierarchy.
- [x] **An attachment is not served to a stranger.** The download route had no
      authentication. Ciphertext, so nothing readable came out - but the bytes
      and their size went to anybody who ever saw the URL, and an unguessable
      key that never expires is one leak away from permanent. Pictures stay
      public, because an `<img>` tag cannot carry a header.
- [x] **An invite link**, which is the other half of the friends-only rule: a
      way to let a stranger in that they consent to. `/invite/<code>` is
      redeemed at boot, survives the sign-in it may trigger, and is cleared
      whatever the outcome. The join box takes a pasted link or a bare code.

Chat, on desktop and web:

- [x] **Per-server custom emoji, animated ones included.** Upload a picture,
      name it, type `:name:`. An animated file is stored exactly as uploaded,
      which is the whole trick: re-encoding a GIF through a canvas keeps the
      first frame. The pictures travel inside the encrypted body beside the
      literal shortcode, so a reader outside the server still sees them, an
      older client shows the word that was meant, and deleting an emoji stops
      it being offered rather than breaking every message that used it.
      `MANAGE_EMOJI` is its own permission. Android renders and sends them; a
      GIF is a still frame there until `coil-gif` is added.

- [x] **`:` emoji search.** Two letters and a name, ranked exact-prefix-
      substring, because `:fire` offering `fire_engine` above the flame is how
      people stop using a feature rather than report it. A shortcode table for
      the emoji this app already draws - six kilobytes against a dependency's
      megabyte and a half.
- [x] **A member menu**: message, add friend, mute, copy id. Muting is per
      person and follows the account, and a muted person is silent even when
      they mention you - a mute any mention could bypass is a mute the loud
      person controls.
- [x] **Attachment drop preview & discard handling.** Fixed broken image/video
      previews caused by `useMemo` object URL revocation during React
      re-mounts/StrictMode, and added fallback extension recognition for OS
      file drops. Discarding/closing the send preview modal now clears pending
      attachments from the chat composer state instead of leaving them attached.
- [x] **Member list hidden by default & redundant TopBar toggle removed.** The
      right-hand people / member column on server channels now defaults to
      closed (`showMembers: false`), giving the conversation full width until
      explicitly opened via the channel header member toggle. The duplicate
      TopBar right sidebar toggle was removed.

Calls:

- [x] **The call duration on the desktop and in a browser.** The phone has had
      it from the beginning and neither of the others did, which was never a
      decision: on Android an ongoing-call notification counts itself, and a
      window or a tab has no notification to hang that on, so nobody noticed
      the number was missing rather than switched off.

      Ticked locally rather than kept in the voice store: a running count there
      would be a state write a second for the length of every call, waking the
      participants list, the controls and every tile to redraw one line of
      text. It reads the wall clock each tick instead of counting its own,
      because a background window's timers are throttled hard and a call clock
      that runs slow while the window is behind another one is worse than no
      clock. Shown only while *this* client is in the call - a duration for
      somebody else's call, read from outside it, is a number with no meaning.

- [x] **A call log per person.** `call_sessions` is one row per person per stay
      in a call, opened and closed by the gateway - the thing that holds the
      sockets and therefore the only thing that knows when somebody really
      arrived and left. It carries the channel and the server, how long it ran,
      everybody who was in it at any point while they were, and how much data
      the call moved. Settings has a Call History section reading
      `GET /api/v1/calls/history`, with the month's two totals at the top.

      The channel and server names are copied into the row rather than joined at
      read time. A log is history: the entry somebody most wants back is the
      channel that has since been deleted or the server they have since left,
      and a foreign key would take exactly those rows away at the moment they
      became worth reading. The one key is to the account, which is right -
      deleting an account takes its log with it.

      Data used is the client's own figure and cannot be anything else: media is
      peer to peer, so no service is in the path to count a byte, and asking one
      to be would be the media-server mistake wearing a meter. It is clamped
      before it is written, so the worst a broken client does is write a wrong
      number in its own row. The mesh takes each peer's last reading *before*
      closing the link, because a closed `RTCPeerConnection` answers `getStats`
      with nothing - without that, a call that lost four people one at a time
      reported only the traffic of the last one. A window killed mid-call
      reports nothing at all, and that entry says so rather than saying zero.

- [x] **Calls & Data, and what a call actually did.** The log said a call cost
      400 MB and nothing about why - which is the half somebody on a metered
      connection can act on. A mesh call is not one connection but one per other
      person, and they do not behave alike: the link that went through a relay
      is usually the whole answer.

      `call_sessions` now carries the total split by direction and a `links`
      column - one entry per peer connection, with who it was with, what it
      moved each way, its round trip, its loss, and whether ICE settled on a
      direct path or on TURN. The split is kept beside the old total rather than
      derived from it: an older client reports only the total, and halves that
      were guessed at would read as measurement.

      Both clients take the transport from the nominated candidate pair, which
      is the only place either end can learn it - the server is not in the path
      to know, and never will be. Nothing reported is checkable, so it is
      clamped on the way in and again on the way out: the rows outlive the code
      that wrote them.

      `GET /api/v1/calls/analytics?days=30` reads the same rows added up - a
      point per day with the empty days present, where the time went, who it was
      spent with, and how many links ever needed a relay. Same rows as the log,
      so the page and the list cannot disagree. Desktop, web and Android all
      draw it; the log itself is per account, so a call taken on a phone and one
      taken on a laptop are in one list.

- [x] **An answer that arrives late is dropped, not applied.** A call on Android
      showed "Failed to set remote answer sdp: Called in wrong state: stable" in
      red across the stage while the tiles said nobody had joined. An unanswered
      offer is re-offered - that is what recovers a link refused over a stale
      channel key - and every offer is answered, so a chased connection gets two
      answers and the second lands after this side has gone to STABLE. WebRTC
      throws rather than ignoring it. Both clients now apply an answer only in
      `have-local-offer`; the desktop had the same hole with no message drawn
      for it.

- [x] **The ring is in the call, on every client.** It existed only in the
      member-list menu, which is the one place it cannot be reached from when it
      is wanted: the full-screen voice view has no member list on it. Both the
      desktop dock and the Android dock now open a list of everybody in the
      server who is not already here.

- [x] **A whole camera, on a phone.** A landscape laptop camera was cropped into
      a portrait screen: the desktop letterboxed the frame and the phone filled
      its tile with the middle of it, so two people in the same call were
      looking at different pictures and the phone was missing the sides - which
      is where the room and anything being pointed at are. Stage tiles fit; the
      ones that still fill are the ones too small to read a whole frame in
      anyway (the PiP window, the filmstrip, your own preview).

      Setting the scaling type was not enough, and the picture stayed cropped
      after it: a `SurfaceViewRenderer` consults its scaling type only in
      `onMeasure`, and what reaches the shader is a matrix built from the
      *view's* aspect ratio - so a surface stretched to fill its parent crops to
      that shape whatever it was told. `VideoSurface` now reads the frames' own
      resolution through `RendererEvents` and sizes the renderer to it, and the
      letterbox is the tile's background showing through.

- [x] **A changed picture, name or server, live on every client.** A profile and
      a server's details were read once at load and never again: change either
      and every other screen in the deployment kept the old one until it was
      reloaded, which for a sidebar nobody clicks is until the app restarts.

      `user.updated` grew a payload and `server.updated` is new, and both carry
      the changed fields rather than announcing that something changed. That is
      the opposite of the rule `friends.changed` follows, and deliberately: an
      avatar has a copy in every message that account ever sent in an open
      channel, in every cached page of history behind it, in the pins, the read
      receipts, the member list, the friend list and the conversation list.
      Announcing it would be one refetch per list on every client that shares a
      room with them. A reply's quoted author is left alone - it is a snapshot
      of a signature, not a reference.

      `chat-service` fans the profile out to everyone entitled to see it: the
      members of every server it is in, everyone it is friends with, and its own
      other devices. Friendships stand in for direct messages, because a DM
      already requires one.

- [x] **The status dot, which was never realtime on any client.** Desktop and
      web read it through `usePresenceStore((state) => state.statusOf)` - which
      selects a *function*, and a function reference is the same one for the
      life of the store. Four screens picked it out, subscribed to nothing, and
      drew whatever colour the dot had when they were first rendered. The
      friends list only worked by accident: it also selects the `online` set, so
      it re-rendered for another reason and the lookup happened to be re-run.
      Android's drawer had the same bug in its own dialect - `Presence.statusOf`
      is a plain read of the current value.

      Nothing was wrong with the backend: presence-service was publishing and
      scoping correctly the whole time. The fix is to select the map, which is
      replaced on every presence event, and do the same lookup on top of it.

Android:

- [x] **Input sensitivity on the phone**, which was the one item here written
      down as blocked by the platform rather than by time. The reasoning was
      right about the two hooks it knew about and wrong that they were all of
      them.

      `setSamplesReadyCallback` hands over a copy, after the buffer has already
      gone to the encoder. `setMicrophoneMute` zeroes the buffer *before* that
      copy is taken - so a gate driven from the meter reads its own silence the
      moment it closes and can never decide to open again. It latches shut, and
      that is exactly why "a level meter driving a mute toggle" was the honest
      description of what those two could build.

      `setAudioBufferCallback` is the third: the live capture buffer, in place,
      before it reaches the encoder. Measured first and attenuated second,
      which is the ordering the whole thing depends on. Same constants as the
      desktop so a threshold means the same on both - 300 ms hold, 6 dB
      hysteresis, 5 ms attack, 150 ms release, ramped per sample because a
      buffer-wide gain step is audible as zipper noise.

      The meter beside the slider is pre-gate, because a meter of the gated
      signal sits at silence exactly when somebody is trying to find the
      threshold that stops it doing that. It only moves during a call: Android
      does not reliably allow a second capture of one microphone, so the row
      says so rather than showing a dead bar. The three things with a bug in
      them have a test each - the latching, the ramp arriving, and a negative
      sample read with the wrong sign.

Encryption:

- [x] **Safety numbers**, so a lying key directory is detectable. The last of
      the E2EE three, and it needed no endpoint: the dialog reads the same
      `GET /e2ee/devices?channelId=` the channel already uses, because asking
      about somebody through a channel you share is a question you were already
      entitled to ask.

      The number is over a user's whole active device set rather than one
      machine - a per-device number would be n by m strings with somebody who
      owns a laptop and a phone, which is a feature people stop using rather
      than report. Keys are hashed as raw curve points and not as JWK text,
      which is the part with a bug in it: two clients serialising the same key
      with their JSON fields in a different order would compute different
      numbers for the same person, and the failure would look exactly like an
      attack. Signal's numeric fingerprint, 5200 iterations of SHA-512, and the
      iteration count is not the number to shave for a faster dialog - it is
      the only thing between a 30-digit truncation and somebody grinding out a
      key that collides with a number already trusted.

      Verification is stored per machine and never on the server, because a
      server that could set "verified" could substitute a key and then reassure
      the person about it. What is stored is the number rather than a boolean,
      so a key that changed since it was checked reads as changed. There is no
      badge in the member list: the iteration count that makes a fingerprint
      hard to forge also makes it too slow for every row of a column.

Remote desktop:

- [x] **`REMOTE_FILE_TRANSFER` and `REMOTE_AUDIO`.** Both were vocabulary and
      nothing else, and both turned out to be one missing thing: the session's
      peer connection carried a video track and had no data channel and no
      audio transceiver. Adding all three up front - for every session, whether
      or not it may use them - is what makes turning either on cost no
      renegotiation, which is a black screen on the controller's side for as
      long as it takes.

      Audio is the machine's own output, asked for at the display capture
      because Electron's loopback is a property of that capture and there is no
      separate device to open. Windows only, and elsewhere the capture hands
      back no track and the session is silent rather than broken.

      A file's *offer* goes over the gateway and its bytes do not. That split
      is the whole design and not an optimisation: a permission nothing sees a
      message for cannot be enforced, so the gateway checks and audits the
      thing that asks, and the bulk that follows is meaningless without it.
      The channel then carries bare bytes - no header, no transfer id per chunk
      - because the offer already said how many to expect, which is what buys
      one transfer at a time. Neither end ever holds the file: the sender walks
      it with `File.slice`, the receiver streams each chunk to disk through the
      main process, and the send buffer is watched so a slow link paces the
      sender rather than growing a buffer until the tab dies.

      Three things the self-check exists for: a file one byte short must never
      report itself whole, a sender past its declared size is cut off rather
      than written, and the name is cleaned on both sides - it is the one part
      of a transfer that arrives as an instruction rather than as data.
      Pulling a file *back* needs a remote file browser and is not this.

Backlog worked down, this pass:

- [x] **Multi-device E2EE.** A key list per user, one wrap per device, and a
      revocation that means something. Two holes the self-check found before
      either shipped: revoking deletes the wraps, so the staleness rule could
      not see the revoked device at all and is now derived from the clock -
      an epoch is stale when a device of a current member was revoked after it
      was minted; and re-registering a revoked device id used to clear the flag,
      which made revocation a suggestion. The migration carries existing rows
      over as a device called `legacy` rather than dropping them, which would
      have made every message written so far unreadable. `API_CONTRACT_VERSION`
      moves to 2.
- [x] **An unread line that survives a restart, and a jump to it.** It was a
      race, not a missing feature: the first channel opened before the read
      markers landed, so the line was placed against an empty table and decided
      nothing was new. The channel waits for them, the markers are cached, and
      the line stops vanishing five seconds after it appears.
- [x] **Manual quality override** for a share and for a remote session - a
      bitrate, a frame rate and a codec, applied inside `shareOptions` so one
      change covers both. This is how a LAN gets told it is a LAN.
- [x] **A recent-servers list, and a client/server version check.** Six
      addresses, newest first; `withRecent` is pure and self-checked because the
      ordering is the part with a bug in it. `GET /api/v1/auth/version` answers
      the contract number, and a deployment that has never heard of the route
      says nothing rather than something alarming.
- [x] **Who-reacted names.** The ids were already in the summary; the joining
      is in `services/reactions.ts` with a self-check, because an empty list, a
      list of one, and the position of "You" are the three cases a
      sentence-builder gets wrong.
- [x] **One screen share at a time**, replacing the one before it the way Teams
      does. Arbitrated at the gateway, because two people pressing the button at
      the same moment need one answer and a mesh has no ordering to give one.
- [x] **Android: reconnect on a network-change callback.** The backoff still
      handles a server that is refusing connections; this makes the other wait
      nothing rather than shorter.
- [x] **Android: microphone processing, a hi-fi mode, and an output route**,
      including the Opus `fmtp` patch that carries bitrate, channels and DTX.
      Input sensitivity is still open and the reason is written down.
- [x] **URL Clickable Hyperlinks & Rich Social Link Previews (Android, Web, Desktop).**
      Added URL link detection and highlighting with clickable links that open in the
      browser across all three platforms. Implemented a safe backend unfurling service
      (`GET /api/v1/messages/unfurl`) extracting OpenGraph/meta tags (title, description,
      preview image, site name, favicon) with in-memory caching and SSRF protection.
      Rendered rich preview cards below messages across Desktop, Web, and Android.
- [x] **Android: WhatsApp-style permission carousel & top notification warning banner.**
      Implemented step-by-step auto-advancing permission carousel with primary action
      buttons, batch authorization, and active permission monitoring. When notification
      permission is denied/disabled, displays a dismissible warning banner on top of
      the chat and friends layouts instead of blocking the app.
- [x] **Clean chat images & social media media saving naming (bu_{timestamp}).**
      Removed filename and size metadata overlay from image attachments in chat,
      giving full, unobstructed image previews. Standardized image/video save
      and download naming across Android and Desktop to `bu_YYYYMMDD_HHmmss.ext`
      matching modern social messaging apps.
- [x] **Android: Permissions onboarding carousel with progress & Allow All.**
      Replaced the static permission list with an interactive swipeable carousel
      and live setup progress indicator. Added a batch "Allow All Permissions"
      action using `RequestMultiplePermissions` alongside per-permission allow
      and skip controls.
- [x] **Android: invite management.** The three API calls existed and no screen
      did, so a server created on a phone could not be joined by anybody.
- [x] **Android: the share quality ladder** was already landed with tests; this
      pass only found that this document still had it open.
- [x] **Android: an invite link that opens the app, and OAuth through Custom
      Tabs.** Both were listed open here and ticked in `ANDROID_TODO.md`, and
      the code agrees with the second document: `betweenus://invite/<code>` is
      claimed in the manifest, held in `PendingInvite` across the sign-in it
      may trigger, and redeemed after it; `OAuthFlow` opens a Custom Tab, binds
      the callback to a state value it minted, and draws only the providers the
      deployment reports.
- [x] **Android: reconnect on a network-change callback** was ticked here and
      not in `ANDROID_TODO.md`. The code has it - `core/data/Network.kt`.
- [x] **Markdown-ish bodies on the phone.** Bold, italic, strikethrough,
      inline code, fenced code and quoted lines, in `core/data/Markup.kt`. The
      marks are stripped, which is the part with a bug in it: every span the
      parser reports is an index into the text that comes *back*, and the emoji
      splitter then runs over that same string and appends each shortcode as
      alternate text of exactly its own length, so the offsets still mean what
      they meant. Fenced code is never parsed inside, an unmatched mark is just
      a character, and `snake_case` is not two italics. Tested case by case,
      both halves of each.
- [x] **The `:` menu, the server's own emoji in the picker, and animated ones.**
      `emoji-names.ts` ported table and all, because a shortcode is a contract
      between the clients and a name only one of them knows sends a message the
      others draw as a word. The composer holds a caret rather than a string
      now - the menu has to know what is behind the cursor, and an emoji picked
      mid-sentence goes where the cursor is. `coil-gif` is registered in the
      image loader, so an animated emoji is no longer a still first frame.
- [x] **The member menu on the phone**: message, add friend, mute, copy id.
      Muting is per person and held by the server, so somebody muted on a phone
      is muted on a laptop. Found while adding it: the notification-preferences
      patch sent both quiet minutes on every call, so using the on/off switch
      wiped whatever quiet hours the account had. The two minutes are one
      argument now, and leaving it out leaves them alone.
- [x] **A reply from the shade that cannot be sent is kept.** It was sent inline
      by the broadcast receiver and, when that failed, discarded without a word
      - which is every reply written in a lift or on a train. It goes to disk
      first and out on the next validated network or the next launch; the
      thread says "sending…" until it has; signing out throws unsent words away
      rather than sending them as whoever signs in next.
- [x] **A direct call rings on the phone, full-screen, with the app dead.**
      `call.roster` is the fan-out this was waiting for. A `CallStyle`
      notification with a full-screen intent onto its own activity, because
      showing over a locked phone is an activity property and `MainActivity`
      must not have it for every launch. Answering joins on arrival - pressing
      Answer is consent to open a microphone in a way tapping a notification is
      not - and declining lasts as long as the call, since every arrival and
      departure is another roster push. A server's voice channel keeps the
      quiet notification: a phone that rings for every call happening nearby is
      a phone somebody turns notifications off on.
- [x] **A call on the phone ducks for a prompt and holds for a phone call.**
      Audio focus was requested with no listener at all, so a cellular call
      arriving mid-call left the microphone open and the room going out over
      it. A transient duck lowers what the call plays; a loss closes the
      microphone as well and tells the far end, so the tile reads muted rather
      than silent. Coming back does not unmute somebody who was already muted,
      and no telephony permission is asked for - taking the audio is how the
      platform announces a call.
- [x] **The remote clipboard on the phone, both directions**, gated on
      `REMOTE_CLIPBOARD`. The send half existed and nothing called it; the
      receive half was dropped on the floor. What the machine has copied is
      *shown* rather than written onto the phone: a machine that could
      overwrite the clipboard of the phone watching it could put a URL under
      somebody's next paste.
- [x] **Phase 13 hardening, minus the light theme.** The refresh token is
      sealed by the Keystore and keyed per deployment, so a phone that has used
      two servers holds a token for each and switching cannot present one
      server's token to the other; a token written by an older build is moved
      once and the plaintext deleted. A private CA is handled by trusting what
      the phone's owner installed - pinning needs a certificate known at build
      time and this app is built once for every deployment there will ever be.
      Signing reads the keystore from the environment or a git-ignored file
      beside the project. Crash reporting is opt-in, local, and shared by hand,
      with no SDK phoning a service the operator did not choose. Instrumented
      tests cover the two things that cannot be checked on a JVM - the sealed
      session, and the server switch with the unsent-reply queue - and CI
      builds the debug APK, runs the unit tests and compiles the instrumented
      ones on every pull request.

Chat and media, across all three clients:

- [x] **Replies, on all three clients.** A quote - the author and one line of
      what was said - carried inside the encrypted body, so the server never
      learns who is answering whom and nothing was added to the wire contract or
      the schema. Copied rather than pointed at: the message being answered may
      be a thousand messages back and not on the device at all, and a reply has
      to render without fetching anything. An edit carries the quote through
      untouched.
- [x] **History that pages backwards on desktop and web.** The server has taken
      a `before` since the first day and Android has walked it since its cache
      landed; these two asked for the newest fifty and stopped. The reader is
      put back where they were reading by anchoring on the distance from the
      bottom, which is the one measurement fifty prepended messages of unknown
      height do not change.
- [x] **A cache on desktop and web**, the port of Android's `Cache.kt`: servers,
      channels, direct conversations and the last few hundred messages per
      channel, in IndexedDB, as the ciphertext the server sent. Everything
      paints from it and corrects itself behind the fetch. Decrypted history is
      still memory-only - see the open item below, which this does not close.
- [x] **A preview before media is sent**, on all three clients. The file itself,
      big, with the caption box under it and the batch along the bottom. A chip
      reading `IMG_4821.jpg` is the one thing that cannot catch the wrong photo.
- [x] **Drop a file anywhere in the conversation**, rather than onto the message
      box. A text drag no longer lights the panel up.
- [x] **Video and audio load themselves**, up to 40 MB, when scrolled to. The
      click was never the point - not spending 200 MB on a message somebody
      scrolled past was. An auto-loaded video shows its first frame rather than
      starting to talk. On Android the bytes were already being decrypted on
      arrival, so the card now draws the frame it already had.
- [x] **Join and leave tones**, on desktop, web and Android. A rising pair of
      notes for an arrival and a falling pair for a departure - a voice channel
      is the one screen nobody is looking at, so who is in it has to be audible.
      Synthesised at both ends rather than shipped as a file, at the same two
      frequencies, so a call with a phone and a laptop in it has one vocabulary.
      A whole roster is what the desktop is handed on every change, so who
      arrived is a set difference there (`rosterChange`, self-checked); Android
      is given real join and leave events and does not need one. Off with a
      switch, stored per machine.

Fixed in the same pass:

- [x] **The packaged desktop app died before it opened a window.** Three
      display listeners were registered at the top level of `main.ts`, and
      touching `screen` is what builds it - which Electron refuses to do before
      `ready`. In the packaged ESM build the throw happened while the entry
      module was still evaluating: a dialog saying "A JavaScript error occurred
      in the main process", and no app. They are in the `whenReady` handler now.
- [x] **A share from another app had nowhere to land.** `ACTION_SEND` names
      files and not a conversation, and the app answered that itself - the
      channel that happened to be open, or the drawer if there was not one - so
      a shared photo either arrived somewhere nobody chose or looked as though
      it had been swallowed. `ShareTargetScreen` asks instead: every direct
      message and every text channel, searchable, over whatever was on screen.
      The files still land in the send preview and are still sent by hand.
- [x] **A copied image could not be pasted into a message on Android.** The
      composer caught what the keyboard inserts and only that; a screenshot or
      an image copied from a browser goes on the clipboard, where Android
      offers no Paste at all for a clip with no text in it. A clip holding an
      image now raises a bar with a Paste on it, and only the clip's
      description is read to decide whether to offer it.
- [x] **Sessions that ended themselves, on all three clients.** Two separate
      faults, both of which read as being logged out of a session that was still
      valid. Refreshing the access token ended the session whenever the *request*
      failed - a lift, a laptop waking up, a gateway restarting, a backend still
      coming up - when only a 401 means the credential was refused; a refresh
      that fails for any other reason now leaves a running session alone. And
      both sockets carry the access token in their URL, so it expires while the
      socket is open and the reconnect came back 4401, which the socket treated
      as final: no messages, no presence, an app that looked signed out until it
      was restarted, because nothing else was going to ask for a new token. A
      4401 now refreshes and still goes through the reconnect backoff.
- [x] **Android could not change its server.** A modal bottom sheet composes
      into its own window, so `LocalContext.current as? Activity` was null and
      the `recreate()` after switching deployments went nowhere. `ShareStage.kt`
      had already found this and kept a private helper for it; that helper is in
      `ui-common` now and both callers use it.
- [x] **The wrong microphone, three ways.** Nothing listened for `devicechange`
      while a call was up, so a capture stayed bound to whatever device it
      opened on; each picker enumerated the hardware separately and could
      disagree; and a chosen device that had been unplugged fell back to the
      system default silently, because the constraint is deliberately not
      `exact`. The capture now follows, the list is shared, and the fallback
      says so. The "nobody can hear you" banner carries the input list itself.
- [x] **Android could not find a Bluetooth headset.** Four reasons at once, and
      each on its own was enough: `BLUETOOTH_CONNECT` was in the manifest and
      never requested, so from API 31 the platform reported no Bluetooth device
      at all; the device-type mapping knew `TYPE_BLUETOOTH_SCO` but not
      `TYPE_BLUETOOTH_A2DP`, which is what the same headset is called outside a
      call, so the settings picker saw a phone with no Bluetooth on it; `AUTO`
      was not automatic but a decision to use the speakerphone, which is the
      wrong one for somebody wearing a headset; and below API 31 there was no
      path to a headset at all, because the speakerphone flag cannot name one.
      The permission is now asked for with the microphone when a call is joined,
      both spellings map (with BLE headsets and hearing aids), `AUTO` picks the
      headset over the speaker, and `startBluetoothSco` is the fallback wherever
      `setCommunicationDevice` cannot see the device. The lists are live through
      an `AudioDeviceCallback`, because a headset is put on during a call more
      often than before one.
- [x] **Output and input device pickers on the phone's call screen.** The
      desktop has had both; the phone had an output cycle buried in settings and
      no input choice at all, on the grounds that a phone has one microphone -
      which stops being true the moment a headset is connected. Both are a sheet
      off the call's control row now, and both are still in settings. Android
      routes a call as one communication device rather than a pair, so choosing
      a headset's microphone puts playback there too; the sheet says so.
- [x] **A global permission screen**, shown once after signing in and in
      settings afterwards: everything Android will be asked for, with what each
      one buys and what refusing it costs. A disclosure, not a gate - nothing on
      it blocks the app, and every permission is still requested at the moment it
      means something, so anything skipped can be granted later by tapping the
      thing that wanted it. What it buys is that the list is seen once, with
      reasons, instead of each prompt arriving cold.
- [x] **A channel opened wherever the last one was.** The list scrolled on
      `messages.length`, and two channels holding the same number of messages
      change neither the length nor the offset. It scrolls on the newest message
      id now, jumps without animation on open, follows only from the bottom, and
      stays pinned while attachments decrypt underneath it.
- [x] **Following the conversation is a latch only the reader releases.** The
      correction above did not hold, on any client, and the reason is that
      "following" was answering the wrong question: it meant "is the end of the
      list near the bottom of the screen", recomputed every time anything moved.
      With end-to-end encryption something always moves - a picture is
      ciphertext until it has been fetched and decrypted, so its row is laid out
      at one height and becomes three hundred pixels taller a moment later - and
      the flag that was supposed to put the view back had already turned itself
      off by the time the correction read it. It is a latch now: off when the
      reader scrolls *up*, which is the one thing growth underneath cannot do,
      and on when they reach the end again. `follow.ts` on desktop and web,
      `Follow.kt` on Android, the same cases in both, both tested.
- [x] **The desktop watched the wrong box.** Its ResizeObserver watched the
      message list, so it survived a picture arriving and not the viewport
      getting *shorter* - a typing indicator appearing under it, or the composer
      growing a preview of the photo about to be sent. Measured in a browser:
      133px off the bottom with the latch already off, so nothing later could
      recover it. It observes both boxes now, and lands back at 1px.
- [x] **Android kept nothing it had decrypted.** A `LazyColumn` disposes a row
      as it leaves the screen, and everything the row held went with it: the
      download, the decryption and the decode were all done again when it came
      back, and a photo that had been on screen a second ago was a spinner. For
      a video it was worse - `cacheDecryptedMedia` names its file after the
      clock, so every scroll past wrote another thirty megabytes into the cache
      directory. `MediaCache` is the phone's answer to the `Map` of blobs the
      desktop has always had: bitmaps under an eighth of the heap, video files
      by the `Uri` already on disk, emptied on sign-out.
- [x] **A picture sent from a phone says how big it is.** Every client reserves
      an attachment's space from the pixel size in the manifest, and Android's
      uploader recorded none - so a photo from a phone was the one attachment
      with no reserved space anywhere, including on the phone that sent it.

Infrastructure:

- [x] **One data path for a deployment.** `pnpm data:path /srv/x/betweenus` creates
      `data/postgres`, `data/redis`, `data/media` (with `pictures/` and
      `attachments/`) and `backup/`, chowns the uploads tree to the uid the
      services run as, and writes the four bind paths into `.env`. Compose
      cannot branch on whether a variable is set, so each mount interpolates one
      variable that defaults to the named volume it always used - a deployment
      that never runs the script is unchanged. Not `image/` and `video/` under
      media: an attachment is encrypted in the renderer, so the server never
      learns what it is, and only pictures are stored in the clear.
- [x] **Scheduled database backups, and one before every migration.** A
      `db-backup` container dumps gzipped plain SQL every
      `BACKUP_INTERVAL_HOURS` (weekly by default) and keeps `BACKUP_KEEP` of
      them; a `db-backup-once` one-shot runs before `prisma migrate deploy` and
      `migrate` now waits for it to *succeed*, so a schema change on a deployed
      database cannot go first. `pg_dump` runs from the postgres image so its
      version matches the server's, dumps land under a `.partial` name until
      complete, and plain SQL means a restore needs nothing but `psql`.
- [x] **A `latest` tag that exists.** `promote` pushed one moving tag, the
      channel one, and the channel of a pre-release is `alpha` - so a
      repository that has never cut a stable release had no `<service>-latest`
      at all, while `docker-compose.yml` falls back to exactly that when
      `BETWEENUS_VERSION` is empty. A first deployment therefore died on
      `betweenus:call-service-latest: not found`. Every release now moves both
      tags, and the comment says to drop the second one once a stable line
      ships alongside alphas, or `latest` would walk a production deployment
      onto a pre-release.
- [x] **Service images without the toolchain in them.** The runtime stage was a
      copy of the build stage, so every image carried the whole workspace
      install - two TypeScripts, the turbo binary, esbuild, webpack, the Nest
      CLI, tsx: 465MB of `node_modules` to run `node dist/main.js`. A
      `prod-deps` stage installs the same manifests with `--prod` and the
      runtime is that, plus the `dist` directories laid over it. 818MB to
      519MB per image.

      Three manifests had to be honest about it first, because a `--prod`
      install is what finds this out: `@nestjs/common` and `@nestjs/core` were
      peer *and* dev dependencies of `nest-common` and `auth`, satisfied only
      by the dev half, so the pruned image threw `Cannot find module
      '@nestjs/common'` on boot; `@aws-sdk/client-s3` is `import()`ed by
      `@betweenus/storage` at runtime and was a devDependency, so S3 storage
      would have failed the same way; and `prisma` has to survive the prune
      because the `migrate` service runs `prisma migrate deploy` out of the
      auth-service image.
- [x] **arm64 images.** Everything published was amd64 only, so an arm64 host -
      a 64-bit Pi, an Ampere or Graviton VPS, an Apple silicon Mac without
      Rosetta - could not pull the stack at all: `no matching manifest for
      linux/arm64/v8 in the manifest list entries`. The `images` matrix now has
      an architecture axis and runs the arm64 half on GitHub's arm64 runners,
      which are free for a public repository; QEMU was the alternative and it
      would have emulated `pnpm install` and `tsc` for every image.

      Neither half tags anything. Both push by digest, and a `manifest` job
      names the pair with the single `<service>-<version>` tag every other job
      already refers to - so nothing else in the pipeline changed shape, and
      the Hub tag page looks exactly as it did. That job refuses to publish a
      list with one architecture in it, which is the failure that would
      otherwise look like a working release from any amd64 machine.

Desktop and web, earlier passes:

- [x] **Per-person volume and mute.** Per machine, keyed by user id; a muted
      person plays at zero so unmuting is instant.
- [x] **Push to talk.** `enabled` on the raw capture, so nothing renegotiates.
      Window-scoped: `globalShortcut` reports a press and never a release.
- [x] **Call statistics.** Bitrate, loss, round trip and frame size per peer,
      plus a "nobody can hear you" warning that does not hide behind a button.
- [x] **Private-channel allowlist editing.** "Who is on it" in server settings,
      re-keying the channel on save.
- [x] **Modifier chords.** Every key event now carries the modifiers held when
      it happened, and the machine being driven reconciles to that rather than
      inferring a chord from the order three events arrived in. One module, two
      callers - a remote session and control handed over in a call - and a
      modifier released off-focus is let go on the next key instead of sticking.
      Ctrl+Alt+Del is still Windows' own: no injected input raises the secure
      attention sequence, and nothing here pretends to.
- [x] **The permission editor reading custom roles.** The Roles screen creates
      a role, names it, colours it, ranks it and sets what holding it allows;
      each member's held roles are toggles beside their per-person overrides;
      and the member list wears the colour of the highest-ranked role somebody
      holds. Android's editor still does not draw them.
- [x] **Display hot-plug noticed mid-session.** A monitor added, removed or
      resized reaches the renderer as an event, the agent re-reads its displays
      and re-sends the list, and one unplugged while it was the screen on the
      wire falls back to the primary display rather than freezing.
- [x] **Per-session input targets.** A remote session and control handed out in
      a call carry their own display target and their own held modifiers, so a
      machine doing both at once no longer points both at whichever was set
      last. Every input event says which of the two it came from.

Attachments and pictures:

- [x] **Crop and rotate before a picture is sent or stored.** Drag, pinch or
      wheel to zoom, two buttons to turn, and the frame is the crop. The
      geometry is one module per client - `services/image-edit.ts` and
      `core/data/ImageEdit.kt`, one a port of the other - with a self-check on
      each side proving the same three properties: the frame is always covered,
      the pan is clamped to the picture, and the written file is the crop in the
      source's own pixels rather than an upscale of it. It sits between the
      picker and the avatar upload, and behind a crop button in the send
      preview.
- [x] **Sending in the background, on Android.** `Outbox` is a queue; handing a
      batch to it returns at once and the work carries on under a foreground
      service with an ongoing notification. Before this a send ran in the chat
      screen's own coroutine scope, so a minute-long video pinned the preview
      dialog open for a minute and leaving the channel abandoned the upload with
      its parts already in object storage.
- [x] **Video compressed before it is sent, on Android.** 720p H.264 at 2.5
      Mbps through Media3's Transformer, before the file is sealed. Every way it
      can go wrong ends in "send what was picked": an already-small clip, one
      over twenty minutes, a device with no encoder to spare, and a re-encode
      that came out bigger than its source are all left alone. **Desktop and web
      do not compress video** - there is no equivalent that is not shipping
      ffmpeg into the bundle - so a clip sent from a browser is still whatever
      was picked.
- [x] **A few upload parts at a time rather than one.** Three lanes on every
      client. A single part spends most of its life waiting on the round trip
      rather than on uplink, and out-of-order parts were already supported and
      checked in `packages/storage`.

Android, Material 3 Expressive:

- [x] **The theme.** Tonal ramps - iris, teal, rose, neutral, red - and a
      scheme that names a role off a ramp rather than picking a hex. Depth
      comes off a five-step container ramp instead of shadows. The full
      expressive type scale, both cuts, so weight says how loud a thing is
      where size says how important. A shape scale to 48dp carrying the
      half-steps controls morph between, and `MotionScheme.expressive()` - the
      spring every animation in the app now reads.
- [x] **The legacy palette names still work.** ~1100 call sites name a colour
      directly; every one of those names now points at a tone off the new
      ramps, so the app repainted itself in one commit and the migration to
      `colorScheme` can be a screen at a time.
- [x] **The shared controls.** Buttons and icon buttons take a shape *set* and
      morph under a press; the busy button spins the expressive loading
      indicator and animates its own width so the label does not jump; a list
      row says "selected" three ways at once; chips are real filter chips;
      panels are a tone rather than a border. `BetweenUsMotion` is the whole
      animation vocabulary - four springs, generic in what they animate.
- [x] **The shell.** Screens slide a quarter-width and fade on the theme's
      spring, forward and back, so the stack has a direction; an interrupted
      transition carries its velocity. The rail's home tile fills when it is
      where you are. The connection banner separates trying from failing.
- [x] **The conversation.** The bubble's shape says who is speaking and where
      in a run it sits; your words are the primary container and everyone
      else's the surface. The composer's send button lights up as the first
      character lands and squares off under a finger; reply and edit are one
      banner instead of two copies. Uploads and history report on the wavy
      indicator.
- [x] **The call controls.** A `HorizontalFloatingToolbar` with the five
      settings as toggles inside it and the red leave button as a FAB outside
      it - which also fixes the hand-sized bar that ran off the edge of a
      narrow phone.
- [x] **Sign-in, friends, settings and every bottom sheet** moved onto the
      scheme; the hand-written switch and slider colours went, because the
      expressive defaults now say the same thing off the same scheme.
- [x] **`material3` pinned past the Compose BoM** to a 1.5 alpha, because every
      expressive API is `internal` in the 1.4.0 the BoM resolves.

Android faults found against a real deployment:

- [x] **The phone could never mint a channel's first key.** Publishing wrapped
      keys never sent `senderDeviceId`, which the endpoint requires, so every
      publish failed validation - a new account could not send its first message
      until a web or desktop client had keyed the channel for it.
- [x] **Sign-in dropped the password before starting the session**, so the
      identity backup was never opened on the way in and never uploaded on the
      way out of a registration. Every sign-in ended in a prompt for the
      password that had just been typed.
- [x] **A workspace refresh never loaded member lists**, and a voice roster is
      user ids until a member list turns them into people - so the sidebar said
      "Someone" until the members screen had been opened once.
- [x] **Call signalling for a peer not yet on the roster is held** rather than
      dropped, along with peers announced before the relay has issued our own
      id. The impolite side offers exactly once, so a dropped offer was a tile
      that said "connecting..." for the life of the call.
- [x] **One avatar control in settings**, not two: the account row already drew
      the picture the picker was drawing again beside its buttons.

Android, self-update:

- [x] **The app updates itself from its own GitHub releases.** There is no store
      to notice a new APK for a self-hosted app, so the client checks on every
      launch, on a channel of alpha, beta or stable - cumulative, so beta also
      sees the stable release that supersedes it. It downloads the build for the
      device's ABI rather than the universal one, and hands it to Android's
      package installer, which is the screen that actually asks; nothing
      installs itself - the install is a `PackageInstaller` session, so a
      refusal comes back with its reason rather than as a dialog that closed and
      an app that did not change. The prompt offers install or a snooze, one day
      by default. A WorkManager job repeats the check once a day while the app
      is closed, on unmetered network, which is the only thing that reaches a
      phone that has not been opened in three weeks. See phase 15 of
      `ANDROID_TODO.md`.
- [x] **It was asking the wrong repository.** `Releases.REPOSITORY` said
      `aiyu-ayaan/Nexora`; the releases are at `aiyu-ayaan/BetweenUs`. The check
      ran, found nothing, and said so - so the feature had never once offered an
      update.

Desktop and web, self-update:

- [x] **The desktop app updates itself, per Windows flavour.** Same shape as
      Android and for the same reason: a self-hosted app has no store to notice
      a build for it. The flavour is what decides everything - an installed copy
      is only ever offered `-Setup.exe` and a portable one only ever
      `-Portable.exe`, with no fallback between them, because handing a portable
      copy the installer does not update it, it installs a second BetweenUs into
      Program Files and leaves the portable one running and stale.
      `PORTABLE_EXECUTABLE_FILE` is the only runtime difference between the two
      builds. Installed applies by running the NSIS installer; portable swaps
      its own exe - rename the running one aside, which Windows permits, copy
      the new one into its place, relaunch, and sweep the `.old` file next
      launch - so the copy stays exactly where the user put it. A failure there
      opens the file manager on the download rather than losing it. Channels,
      version ordering and the default channel mirror Android. No
      electron-updater: it would want a `latest.yml` and a publish block and
      still could not update the portable build. See `UPDATES.md`.
- [x] **A browser tab is offered a reload when the deployment moves under it.**
      A tab cannot install anything, so the whole update is a reload; the part
      worth building is noticing. It compares the hashed asset names in
      `index.html` against the ones it actually loaded, which moves exactly when
      the build does and needs nothing bumped at release time - unlike the web
      client's package version, which the release workflow does not touch.
      Either fingerprint coming back empty is "cannot tell" rather than
      "changed", so a 502, a proxy holding page or an offline tab cannot start a
      reload loop.

Notifications:

- [x] **Not woken for a chat open on another device.** The foreground check
      (`AppForeground.visible && Conversation.visibleChannelId == channelId`)
      only ever saw this screen. `/ws/presence` now carries `channel.focus` /
      `channel.blur`, permission-checked like `typing.start`, held in a Redis
      sorted set scored the same way `presence:online` is - so a client that
      dies without saying goodbye ages out rather than silencing a channel
      forever. `notification-service` asks `presence-service` once per message,
      after the mute filter, and drops the readers from the fan-out. Per
      account and per exact channel: any window on #general silences every
      device for #general and nothing else. Every failure of the lookup -
      timeout, refused connection, bad body - answers "nobody is reading",
      because a missed notification is worse than a redundant one. Full design
      and a two-device test in `push-suppression.md`.
- [x] **A notification read elsewhere takes itself down.** Focus stops a push
      being sent and does nothing about one already sitting in a pocket, which
      is half the problem and the half people notice. `markRead` - which every
      client already calls on opening a channel - now publishes `channel.read`,
      and `PushService` fans it to that account's own devices, which cancel the
      conversation's notification and clear its unread badge. The badge is
      cleared *without* posting a marker back (`Workspace.noteReadElsewhere`):
      with the call, every device would answer every other device's read with
      one of its own for as long as they were all awake.

- [x] **Every attachment sends under the foreground service, not only what the
      preview could draw.** A document, a spreadsheet, an audio file took a
      second path from the one above: read, sealed and uploaded inline in the
      chat screen's own coroutine scope the instant it was picked, which dies
      with the screen exactly as the original bug did - so leaving the channel
      mid-upload still lost it. Everything picked now lands in the send preview
      (a file with nothing to look at gets a card with its name and type) and
      goes to `Outbox` like a photo does.

Android, calls:

- [x] **The connection panel.** Bitrate each way, loss, round trip and frame
      size per peer, and the sentence that says which of them is bad enough to
      be what somebody is hearing. `CallStats.kt` is a port of
      `services/call-stats.ts` with `CallStatsTest` mirroring
      `call-stats.check.ts`, the same arrangement `ImageEdit` has - two clients
      in one call must not disagree about what 5% loss is. It costs no extra
      work: the one-second `getStats` poll that decides who is speaking now
      reads the byte counters on the same walk of the report.
- [x] **A dropped link is reconnected, and a call that cannot be reconnected
      ends itself.** The old code called `pc.restartIce()` once on
      `IceConnectionState.FAILED` and stopped - and that single call did
      nothing at all, because a restart only becomes a recovery when somebody
      offers, and nothing here acts on `onRenegotiationNeeded`. Recovery now
      hangs off `PeerConnectionState`, which includes DTLS rather than only
      ICE: `DISCONNECTED` is given four seconds to fix itself (it usually
      does, on a handover), `FAILED` is acted on at once, and the impolite side
      - the only one that offers - restarts and re-offers on a backoff, four
      attempts inside a thirty-second deadline. Past that the tile says "No
      connection" instead of a hopeful spinner, and the peer connection is left
      open rather than closed: who is in a call is the roster's answer, never
      this side's guess. Two whole-call deadlines sit above it: forty-five
      seconds with no signalling ends the call, because by then nobody else can
      see this device in it, and five minutes alone ends it too, because a
      microphone and a foreground service running all afternoon is not a call.
      `CallRecovery` is the policy, pure and tested.
- [x] **The speaking ring lights for your own tile.** It never had: `speaking`
      is read from a peer connection's inbound statistics and no peer
      connection carries your own microphone, so every self tile passed a
      hardcoded `false`. The level now comes off the microphone itself through
      the audio device module's samples callback - which also means it works
      alone in a channel, where there are no statistics at all and where
      "is this thing picking me up?" is the question being asked.

End-to-end encryption:

- [x] **A second machine reads history.** The key directory answers one more
      question - who is missing *any* epoch their owner already holds elsewhere,
      not only the current one - and a client that holds an epoch fills those
      gaps when it opens the channel. Without it a machine signed in today held
      exactly one epoch, could not repair itself because it held none of the
      others, and had nobody looking on its behalf: it minted a fresh epoch and
      every message before that moment was a padlock for good. "Their owner
      already holds it" is the boundary, and it is what keeps this from handing
      a year of history to somebody who joined yesterday.
- [x] **Two words on the row, one sentence for the channel.** The placeholder
      is "🔒 Encrypted"; why, and that it repairs itself as soon as a machine
      holding those keys opens the channel, is said once above the list rather
      than eight times down it.
- [x] **The self-check gives each machine its own keychain.** Its stand-in
      shared one identity across every simulated device, so "a different laptop"
      opened every wrap addressed to the other one and proved nothing - and its
      stand-in directory wrote entries as it validated them, leaving a
      half-published epoch behind on a rejected bundle.

Push notifications (phase 27, messages only):

- [x] **Device registry.** `DeviceToken`, one row per (account, installation)
      and keyed on the installation rather than the token - a token rotates, and
      a table keyed on it grows a row per rotation and then pushes at every dead
      one. The token is unique across the table too, so a phone signing into a
      second account takes the row with it. Registered on sign-in and on
      restore; unregistered before sign-out discards the tokens.
- [x] **Firebase credentials from the environment, never a file.** Three
      variables or one, `pnpm firebase:env` to convert a downloaded key, and
      `serviceAccountKey.json` git-ignored. Unset means push is off and nothing
      else about the service changes.
- [x] **Data-only fan-out on `message.created`.** The server filters what it can
      see - notifications off, muted channel, muted person - and never writes a
      notification, because the body is sealed and it does not know what is on
      screen. Dead tokens are deleted rather than retried.
- [x] **The Android transport.** `FirebaseMessagingService`, with Firebase
      confined to one file so `:core` stays transport-agnostic. A push decrypts
      in place, and is dropped when it is my own message, when the conversation
      is on screen *and* the app is visible, inside quiet hours on this phone's
      clock, or when a mentions-only channel did not mention me.
- [x] **Active chat foreground suppression (WhatsApp rule).** `PushGate.shouldSuppress`
      silently drops incoming pushes for the exact channel currently active in the
      foreground (e.g., Server 1 #general) where messages are already visible.
      Pushes for any other channel or server (e.g., Server 2 #general, or other
      channels on Server 1) still post notifications normally. Verified with unit
      tests in `PushGateTest.kt` ensuring channel/server isolation and lifecycle checks.
- [x] **The notification.** `MessagingStyle`, one per channel, sender picture,
      decrypted image in the expanded view, direct reply from the shade without
      opening the app, mark-as-read, tap-through on `betweenus://channel/<id>`,
      and cleared on open and on sign-out.

Calls:

- [x] **The call that refused whoever joined it.** The fingerprint signature was
      made with the channel key read once at join, and a member arriving in a
      channel it holds no key for mints the next epoch - so the newcomer signed
      with a generation nobody in the call had, was refused with "their media
      key does not match this channel's", and, since only the impolite side
      offers, ended on a tile stuck at "Connecting…" whichever way the refusal
      fell. The key is now re-read when the roster changes and once more when a
      verification fails, on both clients. `mesh.check.ts` pins the retry:
      exactly one re-read, and a forged proof still refused after it.

- [x] **The self-view that was always a blank box, on Android.** Two faults in
      the same four hand-built renderers: a new capture is a new `VideoTrack`
      and `AndroidView` will not rebuild its view for one, so a camera flip
      left the renderer sunk into a disposed track; and a `SurfaceView` over
      another `SurfaceView` is behind it unless it says otherwise, which is the
      self-view over a full-screen peer and the filmstrip over a share. Both
      now live in one `VideoSurface.kt`, keyed on the track and told to draw as
      an overlay where it overlaps.
- [x] **A call on Android is the whole screen and survives leaving it.** The
      system bars are hidden while one runs, the peer's name pill is lifted
      clear of the control dock, and back shrinks the activity into system
      picture-in-picture instead of ending the call. The self-view is draggable.
- [x] **The screen share picker could not be opened, on desktop or in a
      browser.** The button opened it and nothing appeared. The dialog is
      `fixed inset-0`; the control bar it is written inside is frosted glass,
      and an element with a `backdrop-filter` is a containing block for every
      fixed-position descendant exactly as a `transform` is - so `inset-0`
      stopped meaning the viewport and started meaning the pill the buttons
      live in, and the dialog was laid out a few hundred pixels wide inside the
      toolbar. It renders through a portal into `document.body` now, which puts
      it out of reach of any ancestor's paint effects, in the docked bar and the
      theatre one alike.
- [x] **Picture-in-picture on Android refuses cleanly.** It needs no permission
      - nothing to declare, nothing to ask for, and what it does need was
      already on `MainActivity`. What it has is three ways to be refused, and
      all three used to arrive as a caught exception. A device with no
      picture-in-picture and an activity that is finishing or not in front are
      both asked about first and answered with a plain false; the catch stays
      for the per-app switch under Special app access, which is on by default
      and has no public getter. And whether the call *is* the little window is
      asked of the activity every time rather than cached against a
      `Configuration`, which is compared by value and so could hold the old
      answer; the configuration is what says *when* to look, not what the
      answer is. `addOnPictureInPictureModeChangedListener` would be the direct
      way to put it and is not available - androidx.activity 1.13 removed both
      it and `PictureInPictureModeChangedInfo`, which is what broke the release
      build when this first landed.
- [x] **Adding somebody to a server from the phone searches.** The field asked
      for a username typed exactly right and gave no sign whether a failure was
      the spelling or the feature; it now offers what it finds, friends-only,
      with those already in the server filtered out.

Call screen on the phone:

- [x] **The chrome gets out of the way.** The header and the control dock fade
      out after four seconds with nothing happening and come back on a tap
      anywhere on the stage - the gesture the share stage already had, and what
      the picture filling the screen was asking for. A sheet, a problem to
      explain, or a control that was just pressed pins them open: the toggles
      are keys of the countdown, so pressing one restarts it without every
      button having to say so.
- [x] **The self-view snaps to a corner.** It was a free drag that left the
      tile anywhere, including half over somebody's face. It settles into the
      nearest corner now, chosen by which quadrant of the stage its own centre
      ended in, with the top and bottom insets keeping it clear of the header
      and the dock. The corners come from where the tile was actually placed
      rather than from the screen: the callers do not agree on where that is -
      most anchor it top-end, the four-person layout anchors it bottom-end -
      and the old arithmetic assumed the first and clamped the second into
      dragging itself off the bottom of the screen. `pipBounds` and
      `pipNearestCorner` are the whole of it and are tested.
- [x] **Video actually has the rounded corners it appears to have.** A
      `SurfaceView` is its own surface composited under the window, so
      `Modifier.clip` above it does nothing: every tile in a call had square
      video inside a rounded border and a rounded shadow. `VideoSurface` now
      masks the four corner slivers with the tile's own colour, which the
      window does draw over the surface - the same reason the name pill and
      the flip button are visible on top of the video.

Release:

- [x] **A release can be for one platform.** A marker may name what it is for -
      `!alpha(android)`, `!fix(android,desktop)`, `!feat(docker)` - and only
      that is built. The names are read as platforms only when the whole scope
      is platform names, so `!feat(chat)` is still a scoped feature that builds
      everything; half a platform list is not one, and treating it as one would
      ship a release with two thirds of it missing.
- [x] **What a release skips is carried into it, not left behind.** The images
      of the last release are re-tagged under the new version - `imagetools
      create` copies the manifest list whole, both architectures, no rebuild
      and no pull - and its installers and APKs are re-attached. So
      `<service>-<version>` exists for every service of every version, `latest`
      never points at a partial set, and a Release always has a full download
      list. It carries transitively: assets carried into v0.0.6 are v0.0.6
      assets, and v0.0.7 takes them from there.
- [x] **The notes say which is which.** Every entry ends with a table naming
      each platform and either "Built here" or the release its artifacts came
      from. It goes into `CHANGELOG.md`, not only into the GitHub Release, so it
      is in the release PR's diff where it can still be argued with.
- [x] **What a release builds survives the merge.** A merge commit's subject
      says nothing and `git show --name-only` prints nothing for one, so the
      target list is written to `.github/release-targets` by the release PR and
      read back after it merges - the one shape that carries through a squash, a
      rebase and a merge commit alike. Absent, it means everything, which is what
      every release before this did.

Documentation:

- [x] **`RELEASING.md`** in `development/`: the two steps, the markers, the
      per-platform scopes and what carrying forward actually does.
- [x] **`FCM/`** in the repository root: the architecture and the setup in
      `README.md`, the wire format and the order of the gates in `PAYLOADS.md`,
      and what to try first in `TESTING.md`.
- [x] **Post-SFU corrections** across `TODO.md`, and phase 27 opened for push.
- [x] **This pass**, recorded here and in `ANDROID_TODO.md`.

Calls — the second pass over the call screen:

- [x] **The speaking ring on desktop and the web, which had never once
      appeared.** It was driven by `RTCRtpReceiver.getSynchronizationSources()`,
      which reports a level only for sources Chromium considers current and is
      routinely empty on a connection carrying perfectly good audio - so the
      number behind the ring was almost always zero. `inbound-rtp.audioLevel`
      carries the same reading and is always there; it is what the Android
      client has been reading all along, which is exactly why the ring worked
      there and only there. Read asynchronously, so the poll uses the previous
      tick's answer - 200 ms behind a syllable, which nobody can see.
- [x] **Video that is actually inside its rounded corners.** A
      `SurfaceViewRenderer` is a `SurfaceView`: a separate surface composited by
      the system rather than pixels in the window, so nothing in the window
      clips it and `Modifier.clip` does nothing at all. The corner mask that
      worked around it paints the four slivers in the tile's own background,
      which is only correct when the tile sits on something opaque - and the
      floating self-view floats over whoever else is in the call. It now renders
      through a `TextureView` (`ClippedVideo.kt`), which is drawn by the window,
      so it clips, composites with what is under it, and stacks by ordinary view
      order instead of `setZOrderMediaOverlay`. The full-screen tiles and the
      share stage keep the surface renderer: it costs a copy per frame and they
      have an opaque background to mask against.
- [x] **The caller's name sits where a caption sits.** It was held 92dp clear of
      the control dock whether or not the dock was there, so with the chrome
      gone it floated in the middle of somebody's chest. It follows the dock now.
- [x] **Picture-in-picture shows whoever is talking.** One tile's worth of room
      goes to the person speaking, never to your own camera - the one face in
      the call you are not there to watch. Sticky on the last speaker, because a
      conversation is mostly gaps and a window that flicked between faces
      through every pause would be worse than a fixed one.
- [x] **Incoming video that stopped flickering.** Android read "no `inbound-rtp`
      entry in this stats report" as "no frames decoded" and took the track away
      until the next poll put it back. `framesDecoded` only grows, but the
      report is not a promise - one arrives empty after a renegotiation, and a
      mid can change under one. Latched per slot, which is what the desktop
      client has done since the same bug was fixed there.
- [x] **Audio devices that follow what is plugged in.** A device id is
      remembered forever and the operating system's default is not, which is the
      whole of having to set the microphone and the speakers again every call:
      choose a headset once and every later call is pinned to it, connected or
      not. `Follow whatever is plugged in` (Settings → Voice & Video, on by
      default) drops the pin when the hardware changes, so the system default -
      which is the thing that was just plugged in - wins. A `setSinkId` for a
      device that has gone now falls back to `default` instead of leaving the
      element wherever it was.
- [x] **The tile stuck on "Connecting…" after a call moves between devices.**
      Two faults, both of them a link that can never recover, and both on every
      client. The first: the channel-key re-read was allowed **once per peer**
      and then never again, so a link could survive exactly one epoch change.
      One is normal - joining a channel you hold no key for mints the next
      epoch, which is precisely what a device arriving does - and burning it on
      the first description left every one after that refused against a key
      known to be stale, with nothing left that would ever look again. It is a
      cooldown now, which keeps the property the latch was there for: a proof
      that is simply wrong still cannot make a client hammer the key directory.
      The second: **nothing chases an offer that is never answered.**
      `connectionState` only reaches `failed` once ICE has a remote description
      to fail against, so a refused offer leaves the connection in `new` with no
      event ever fired and no recovery path to enter - the desktop's ICE-restart
      path and Android's recovery loop both hang off a failure that never
      happens. The offering side now re-offers from `new`, four times, re-reading
      the key first; only the impolite side, and only from `new`, so a link that
      is genuinely negotiating on a slow network is left alone. And on desktop a
      refused description no longer *drops* the link: nothing re-adds one, so the
      far end's next offer arrived for a peer that no longer existed, and one
      refusal ended that pair for the life of the call.
- [x] **The same on Android, for the whole call rather than for the sheet.** The
      `AudioDeviceCallback` lived in `rememberCallDevices`, which only exists
      while the device picker is open - so the one gesture it was meant to
      serve, putting a headset on mid-call, moved nothing unless the picker
      happened to be up at that moment. It is registered for the length of the
      call now, and a route or input pinned to a device that has just been
      unplugged goes back to `Automatic` rather than to silence.
- [x] **Two devices at once.** Refresh-token reuse revoked every live token for
      the account, so a token replayed on a phone - an interrupted rotation, an
      app resumed after the grace window - signed the laptop out as well, and
      being signed in on two devices was not possible for long. A token now
      carries the family it descends from: one sign-in is one family, every
      rotation of it stays in that family, and reuse revokes that chain only.
      Changing the password still ends every session. `familyId` is a column,
      migrated by making each existing row its own family.
- [x] **A browser tab that shows its notifications.** The first notification
      worth raising asked for permission and then returned, so the message that
      prompted was dropped - and where a deployment has no VAPID keys nothing
      else ever prompts, which is why a tab appeared to have notifications and
      never showed one. It is shown once permission is granted, and Settings has
      a button that asks from a gesture, which is the only kind of request
      Firefox and Safari honour.
- [x] **The unread line goes away when it has been read.** It is placed when
      messages arrive at an unfocused window; coming back to that window marks
      them read but left the line, so being rid of it meant reloading the page.
      It fades five seconds after the channel it is in has been read, and only
      for a channel that is on screen - everywhere else it is still a place to
      come back to.
- [x] **A visible reconnect, with an end to it.** Both clients reconnected
      silently, so a window or a phone that could not reach the backend looked
      exactly like one nobody had written to. Every socket reports into one
      connection state; a bar shows a spinner and "Reconnecting…" while it
      retries. The backoff also had no end, which is a spinner with no end: a
      socket down for thirty seconds is given up on, the bar says "Disconnected"
      and offers a button that starts the ladder again. On Android a returning
      network still restarts it by itself.
- [x] **A call goes on hold, visibly, when a phone call takes the audio.** The
      microphone already closed - the audio focus is how the platform announces
      a cellular call - but the far end saw a muted tile, which reads as a
      choice, and this end saw nothing. The hold travels with the media state,
      so every client draws "On hold" for whoever has been pulled away, and the
      phone shows a banner. A *permanent* focus loss has no "gain" coming, so a
      call held by one stayed held: the focus is asked for again when the call
      screen returns to the front, and from a Resume button.
- [x] **The Android call bar fits the phone.** Six fixed buttons and fixed gaps
      came to about 400dp - wider than the screen - so the bar ran off the right
      edge and took the hang-up button with it. It is sized to the screen, with
      the gaps taking what is left over.
- [x] **Read receipts - who has seen your message.** No new table: the read
      marker each account already keeps per channel only ever moves forwards,
      so "who has seen this message" is "whose marker is at or past its
      timestamp". It is the same row the unread count is derived from, which is
      why the two can never disagree.

      `notification-service` serves the other members' markers for a channel
      (`GET /api/v1/notifications/channels/:id/reads`), with the caller left out
      and anybody no longer in the audience left out with them; `chat-service`
      broadcasts `channel.read` to the channel when a marker moves, so a receipt
      appears while the sender is looking at it.

      The row is up to four faces and a count, bottom right of your own
      messages. Faces rather than a tick, because the question anybody asks of a
      group is *who* has seen it. Each reader appears once, against the newest
      message of yours they have got to - drawing everybody against every
      message would repeat the same four faces down the conversation and say
      nothing new each time. Opening it gives the send time and each person's
      read time, described as the marker it is: "had the channel open at",
      not "looked at this line at", because the marker is all the server has.

      The arithmetic is written twice and tested twice against the same cases -
      `apps/desktop/src/features/chat/receipts.ts` and
      `core/store/Receipts.kt` - because a phone that anchors a face against a
      different message than the desktop does is two answers to one question.
- [x] **Reply without opening a menu.** A double click on desktop and web - a
      double tap where there is no right button at all - and a left-to-right
      swipe on Android. It is the action the message menu is opened for most.
      A double click that is selecting a word is left alone; the swipe fires
      only past a threshold, buzzes at the point of no return, and settles back
      on a Material 3 expressive spring, so the row overshoots rather than
      merely sliding back.
- [x] **No browser context menu on web.** The app draws its own menu on a
      message, and Chrome's - Back, Reload, View source, Inspect - appearing a
      pixel outside it was the tell that this is a page rather than an
      application. Suppressed on the bubble phase, so React's handlers still run
      and the message menu opens as before. The Electron build has no such menu
      to suppress.
- [x] **Error 153 on every Listen Together track in a packaged build.** A
      packaged build serves the renderer from `file://`, and a YouTube embed
      framed by a `file://` document is refused outright - "Video player
      configuration error" over a black frame, on every track. Two obvious
      fixes were measured and neither works: filling in the `Referer` header
      moves the refusal from 153 to 152 and fetches no media at all, and
      serving the renderer from a custom `app://` scheme registered standard
      and secure behaves identically. Only an `http`/`https` ancestor counts.

      So the main process serves one page over loopback -
      `http://127.0.0.1:<port>`, a port the OS picks, behind a random path -
      and the renderer frames that; the page frames the embed and relays
      messages both ways, checking origin and source in each direction. The
      protocol in `services/youtube.ts` is unchanged and the app's own origin
      does not move, which is the point: serving the whole renderer over
      loopback would work too and would move every user's device identity,
      endpoint and settings to a new origin - a re-login and a re-keyed E2EE
      device for a music player. Where the origin is real already - the web
      client, a dev run - the embed is framed directly, as before.

      Checked end to end under Electron with the real `YouTubePlayer`, from a
      `file://` document: position, duration and title arrive and the media
      requests flow (`electron/youtube-relay.check.ts`,
      `src/services/youtube.check.ts`).
- [x] **`EBUSY` on every portable update.** The portable launcher holds its own
      exe open while the app it unpacked is running, so the one process that
      could never rename that file was the app doing the renaming - and the
      update strip said so, with the download left in a folder to be run by
      hand. The swap is now a PowerShell script that outlives the app: wait for
      the process to exit, retry while the handle clears, copy the new build
      over the kept exe, start it (`electron/portable-swap.ts`). Its check runs
      the real script against an exe held with an exclusive handle by a live
      process, and asserts first that an in-process rename genuinely fails.
- [x] **The window controls sat on top of the notice strips.** Windows paints
      the minimise/maximise/close overlay into the top forty pixels of the
      window whatever the renderer draws there, and `TopBar` is the only row
      that leaves a gap for it. The connection, version and update strips were
      above it, so "Restart and install" came out as "Res". They render under
      `TopBar` now, with a check on that order.

---

## Open

Ordered within each group, roughly by what unblocks the most. Nothing here is
blocked by anything outside this document.

### Backend

- [ ] **Identity rotation after a lost device**, re-sealing current channel keys
      for the new identity. The device list it depended on now exists, and
      revoking a device already re-keys every channel it could read - what is
      left is rotating the *account* identity when the backup itself is
      suspect.

- [ ] **Split the shared Prisma schema per service, and stand up
      `user-service`.** The largest single item on this list and the one with
      the widest blast radius; profiles, avatars and friends are served by
      chat-service today.

### Desktop and web

- [ ] **Edit history, encrypted reactions, paged search, a pinned panel that
      pages.** Four separate message-side gaps, listed together because they are
      one screen's worth of work each. (Who-reacted names landed.)
- [ ] **A light theme.** The ramp is defined once, which is what makes one
      possible; nothing else about it has been designed.
- [ ] **Decrypted history persisted under a device key.** The ciphertext is on
      disk now - see the cache above - so a restart no longer means an empty
      window. What is still memory-only is the *decrypted* copy, so every
      message is opened again on launch. Sealing plaintext at rest under a
      device key is what would close this.
- [ ] **Chunked AEAD attachments, and a video transcode.** The first lifts the
      100 MB ceiling; the second means ffmpeg in the client.
- [ ] **Input injection on macOS and Linux.** CGEventPost and XTEST/uinput, one
      backend each behind the same three-function interface.
- [ ] **The headless `remote-agent`.** Still a scaffold. A server has no BetweenUs
      window to run the agent inside, which is what it is for.
- [ ] **Decide whether the shared UI moves to `packages/ui`.** Worth a rename
      only if a third client appears; today it would change nothing else.

### Android


- [ ] **Put the expressive redesign on a screen.** It compiles, the unit tests
      pass and the debug APK builds, and no part of it has been looked at. The
      six things to check first are listed at the end of "The expressive
      redesign" in `ANDROID_TODO.md`; contrast on the hand-written tonal ramps
      and the call toolbar on a narrow device are the two most likely to be
      wrong.
- [ ] **Decide what to do about the material3 alpha.** The client is pinned to
      a 1.5 alpha past the Compose BoM, because every expressive API is
      `internal` in the 1.4.0 the BoM resolves. It is the one artifact here not
      taking its version from the BoM, and an alpha may rename things between
      builds.

- [ ] **Remote file transfer on the phone**, gated on `REMOTE_FILE_TRANSFER`.
      No longer blocked on a wire that does not exist: the gateway has the
      offer, the desktop agent receives, and a session negotiates a data
      channel - see the desktop entry above. What is left is Android's own end
      of it, which is a file picker, a `Uri` read in chunks and the same
      offer-then-bytes order the desktop uses. The clipboard, which shares the
      item it used to be half of, landed - see below.
- [ ] **A light theme on the phone**, which is the same item the desktop has and
      is open for most of the same reason. Cheaper than it was: the Material 3
      Expressive redesign gave the client a real `ColorScheme`, so a light
      theme is a second `lightColorScheme` rather than a repaint. What is left
      is that about a thousand call sites still name a palette constant
      directly instead of reading a role - and nothing about a light BetweenUs
      has been designed.

---

## Nothing here has been in front of a human

Every landed item above is typecheck-and-self-check confidence and nothing more.
No backend has been run in the session that wrote them, so the smoke scripts
changed along the way - presence scoping in `presence-service/smoke.mjs`,
invites in `chat-service/smoke.mjs` and `notification-service/smoke.mjs` - have
been syntax-checked and not executed.

**Five migrations are waiting, and two of their names sort backwards.**
`20260810100000_custom_roles` and `20260810110000_attachments` exist as SQL and
have to be applied - `pnpm db:migrate` - before the roles screen or any
attachment upload can work at all. Both are stamped 10 August while migrations
already applied are stamped the 16th, so they sort *before* the history a
running database has. `migrate deploy` applies them anyway; `migrate dev` may
call it drift and offer a reset, which on a database with anything in it is the
wrong answer. Renaming both to a stamp after `20260816140000_server_invites`,
before either reaches a deployment, is the cheap fix.

The third is `20260818120000_multi_device_keys`, which sorts correctly and has
to be applied before any client on contract 2 can publish a key. It rewrites
`device_keys` and `channel_keys` in place and carries every existing row over -
see the file, which says why each step is what it is. It has never been run.

The fourth is `20260818140000_muted_users`, one array column on
`notification_settings`. It was written with `NOT NULL` and corrected: Prisma
emits a list column as a nullable array with an empty default, and a migration
that disagrees with what `prisma migrate` would generate is drift - which is
what turns the next `migrate dev` into an offer to reset the database. The
check that caught it is `prisma migrate diff --from-empty --to-schema-datamodel`,
which needs no database and is worth running against any hand-written migration.

The fifth is `20260818160000_server_emoji`, whose DDL was copied out of that
same command rather than written by hand - which is why its index names and its
cascade match what `migrate` expects without anybody checking.

The cases most worth putting a person in front of, in order:

1. `pnpm dev:duo`, two accounts, one voice channel: per-person volume, push to
   talk, and the connection panel. Push to talk and the statistics are the two
   that can look right and be wrong.
2. An attachment, end to end: send one, delete the message, and confirm the
   object is gone from storage on the sweep - and that a file uploaded but
   never sent goes too. The sweep waits ten minutes after boot and then runs
   every six hours, so this needs either patience or a shortened
   `ATTACHMENT_GRACE_HOURS` and a restart.
3. A chord on a remote session: Ctrl+C and Ctrl+V across the link, then
   Alt+Tab away mid-chord and type a letter - it must arrive as a letter and
   not as a shortcut, which is the whole point of the reconciliation.
3a. A file over a remote session, which has never had a byte through it. Drop
   one on the screen, watch it land in the machine's downloads folder, then
   drop the *same* file again - it must become `name (2).ext` and not an
   overwrite. Then cancel one part way and confirm nothing is left behind: a
   truncated file that looks whole is the failure nobody notices. A file large
   enough to make the progress bar move is the only way to see the backpressure
   working at all.
3b. `REMOTE_AUDIO` on Windows: play something on the machine and confirm the
   sound button appears and does what it says. On any other platform the
   correct outcome is no button, because the capture hands back no track - the
   thing to check there is that the session is silent rather than broken.
4. The roles screen: invent a role, colour it, give it one capability, hand it
   to somebody, and watch their name change colour in the member list. Then
   try to put a capability into it that you do not hold yourself - it must be
   refused.
5. An invite: mint one with a use limit, spend it, watch the second person be
   refused, then revoke another and watch that refused too.
6. A private channel: remove somebody from "Who is on it" and confirm they stop
   being able to read what is sent afterwards.
7. Two accounts on different servers, signed in at once: neither should see the
   other's presence at all.
8. Two monitors: open a remote session, unplug the one being watched, and
   confirm the picture falls back to the primary rather than freezing.
9. The container stack end to end, which has still never been run.
10. A reply, both ways round: send one from the phone and read it on the
    desktop, then the reverse. The quote is written by the sender and read by
    everyone else, so a mismatch in `MessageBody` shows up as a message that
    renders as a paragraph of JSON - which is exactly how the last encoding
    disagreement was found.
11. A channel with more than fifty messages on the desktop: scroll to the top
    and keep scrolling. The reader must stay where they were rather than being
    thrown up or down as each page lands, and "this is the start of the
    channel" must only appear at the actual start.
12. The cache, with the network off: sign in, open a channel, quit, disconnect,
    and launch again. Servers, channels and the last messages must be on
    screen. Then sign out and confirm it is empty on the next launch.
13. A headset plugged in mid-call, on desktop: with nothing chosen it must move
    to the new default, and with a device chosen and then unplugged and
    replugged, the capture must come back to it.
14. Android's server picker, which is the fix least visible from the code: from
    Settings, switch deployments and confirm the app actually restarts into the
    other one.
15. Multi-device keys, which is the change with the most that can go silently
    wrong: sign in on a second machine and confirm it reads the channel without
    the first one being open, then revoke it from the first and confirm the
    channel re-keys, the revoked machine reads nothing sent afterwards, and
    signing in on it again is refused rather than quietly re-admitting it. The
    migration wants a database with real rows in it, not an empty one - the
    whole point of it is what happens to the keys that already exist.
16. Two people sharing a screen: press the button on the second machine while
    the first is sharing. The first must stop, both must agree who holds it, and
    the one that was replaced must say why rather than appearing to have
    crashed. Then have the holder leave the call and confirm the screen is free
    rather than held by a socket that has gone.
17. The two authorization fixes, which are the ones worth a person: with two
    accounts that are *not* friends, try to add one to a server from the members
    screen - it must be refused, and the picker must not have offered them.
    Then promote somebody to moderator with MANAGE_MEMBER and confirm they can
    neither edit nor kick the owner.
18. An invite link end to end: mint one, open it in a signed-out window, sign
    in, and land in the server. Then open the same link again and confirm it
    does not rejoin after leaving.
19. Custom emoji, end to end: upload a GIF, send `:name:` from the desktop,
    read it on the phone, then delete the emoji and confirm the message still
    draws it. The last part is the one the design is for - the picture is in
    the message, not in the server's list.
20. The shrunk Android APK on a real device. R8 is on now, and the one thing a
    successful build does not prove is that no keep rule is missing: a class
    reached by name from native code fails when a call starts, not when the app
    does.
21. A channel of photos, on all three clients, which is the one this pass is
    for: open one whose last few messages are pictures and videos, and watch it
    while they decrypt. It must be at the newest message when they have all
    arrived, not somewhere above it. Then scroll up into history and back down;
    a picture that has been on screen once must come back as a picture and not
    as a spinner, and the phone is where that was worst. Then attach a photo
    without sending it - the composer grows a preview, the viewport gets
    shorter, and the newest message must not end up behind it. Last, scroll up
    to read something while pictures are still arriving below: the view must
    stay where it was put, because the whole rule is that only the reader moves
    it.
22. The join and leave tones with three people in a call, which is where the
    two failure modes live: joining a channel that already has two people in it
    must play one tone and not two, and nobody should hear a tone for a peer
    connection that merely reconnected. Worth listening to on a headset plugged
    in mid-call as well - on the phone the tone follows the call's route, and
    an arrival in the earpiece while the call is elsewhere is the bug that
    would show.

23. **Push, end to end**, which is the one nothing above covers and the one
    with the most ways to be wrong. `FCM/TESTING.md` is the ordered version;
    the four that matter are: a token reaching `device_tokens` at all; a
    message waking a swiped-away app and arriving with its *words*, which
    means a cold process restored a session and fetched a channel key; no
    notification for the conversation on screen, and one for the same
    conversation with the screen locked; and a reply typed into the shade
    landing in the channel on both clients without the app opening.

`TESTING.md` is the fuller version of this list and predates it.

24. **The call that connected about half the time**, which is the fix with the
    least to look at and the most to prove. Start a call from the phone, have
    somebody join from the desktop, and confirm both hear each other. Then do
    it again, four or five times, leaving the call properly between each -
    the fault was a coin toss on a stale peer id, so one working call proves
    nothing and five do. Then the reconnect case, which is the other half:
    with a call up, put the phone into aeroplane mode for ten seconds and back
    out. It must rejoin and still carry audio, not come back to a roster of
    tiles stuck on "Connecting…".

25. **The four new pushes**, which need two accounts and a phone whose app is
    swiped away. Send a friend request and accept it from the other side; add
    the account to a server; start a call in a voice channel it can hear and
    then leave, which must make the call notification go away on its own. Last
    and most interesting: send a message, wait for the notification, then
    delete the message from the other client - the notification must lose that
    line, and vanish entirely if it was the only one. `FCM/PAYLOADS.md` says
    what each push carries and what is deliberately not filtered.

26. **Somebody joining a call they have never had the key for**, which is the
    one the epoch re-read exists for. Use an account that has just been added
    to the server and has never opened the channel. Start a call from one
    device, join from theirs, and confirm both hear each other with no "their
    media key does not match this channel's" and no tile left on
    "Connecting…". Then do it the other way round - the new account starts the
    call and the older one joins - because who offers depends on a peer-id
    comparison and only one of the two orderings was ever the visible failure.
    Worth a third pass with a third person joining while the first two are
    already talking.

27. **The phone's own camera, which nobody had seen work.** In a call with one
    other person: the self-view must show the camera, mirrored, and keep
    showing it across a flip, a turn off and a turn on, and a share started and
    stopped. Then the same from the other side of the same call - the fault was
    in the renderer, not in what was being sent, so a tile that looks fine to
    the far end can still be blank locally. Then back out of the call: it must
    shrink to a floating window with the call still running and audio still
    flowing, and tapping it must come back to the full screen.

28. **The ringing call**, which is this pass's item with the most that can be
    wrong and the least that a build proves. Two accounts, a direct
    conversation, and the phone's app swiped away: start a call from the other
    client and the phone must ring - full screen, over the lock screen, with a
    ringtone. Answer must land in the call with audio flowing rather than on
    the join button. Then do it again and press Decline: the ring must stop and
    must *not* come back when a third person joins the same call, because every
    arrival is another roster push. Last, start a call and hang up before
    answering: the notification must go away on its own. A full-screen intent is
    the thing manufacturers differ about most, so this is worth trying on two
    makes of phone rather than one.

29. **A phone call arriving during a BetweenUs call**, which nothing but a real
    SIM can test. With a call up, ring the phone: the microphone must close and
    the far end must see the tile go muted, not silent. Answer the phone call,
    end it, and the BetweenUs call must come back - and must *not* unmute
    somebody who was already muted before it rang. Then the ducking half: get a
    navigation prompt or an assistant to speak over the call and confirm it
    goes quiet rather than away.

30. **A reply typed into the shade with the phone offline.** Aeroplane mode,
    reply from the notification, and the thread must say "sending…" rather than
    swallowing it. Turn the network back on: it must arrive, once. Then the
    harder half - reply offline, force-stop the app, and launch it again: it
    must still go. Last, reply offline and sign out: it must never arrive,
    because unsent words belong to the account that wrote them.

31. **Markdown and the `:` menu against another client.** Send `**bold**`, a
    fenced code block and a quoted line from the phone and read them on the
    desktop, then the reverse - the marks are stripped by the sender, so a
    disagreement shows up as asterisks on one side and not the other. Then type
    `:fir` in the composer: the flame must be offered above the fire engine,
    the server's own emoji must be offered above both, and picking one
    mid-sentence must put it where the cursor was rather than at the end.


32. **The speaking ring, on the two clients that never had one.** A call between
    a desktop or web client and anybody else: the ring must light on the other
    person's tile while they talk and go out when they stop, within about a
    fifth of a second, and it must do it whether or not the far end is Android.
    Then mute yourself: your own ring must go out immediately rather than a
    beat later. The reading now comes from `getStats`, so the case worth being
    suspicious of is a call with more than two people - one poll per peer per
    tick - on a laptop with something else running.

33. **The floating self-view over somebody's face.** In a one-to-one video call
    on the phone, the small tile's corners must show the person behind it,
    rounded, with no square edge and no block of dark. Then drag it to each of
    the four corners, flip the camera, turn the camera off and on, and start and
    stop a share: the picture must survive all of it and stay clipped. This is a
    different renderer from the one the full-screen tiles use, so a tile that
    looks right is not evidence about the other.

34. **Devices that follow what is plugged in.** On desktop, join a call, then
    plug in a headset: both directions must move to it without touching a menu,
    and unplugging it must move them back. Do it again with `Follow whatever is
    plugged in` turned off - nothing must move. Then the phone: put a Bluetooth
    headset on mid-call with no sheet open, which is the case that never worked,
    and take it off again. Last, the failure that has no sound to it - pick a
    wired headset explicitly, unplug it, and confirm the call comes out of the
    phone rather than out of nothing.

35. **A call moved between devices, which is the one with a report behind it.**
    Two accounts in a call from the web client; one of them joins the same call
    from the phone. The person who stayed put must see the newcomer's tile go
    from "Connecting…" to a live one within a few seconds - and if it does not,
    it must recover on its own within about half a minute rather than staying
    there. Do it the other way round as well, phone first and web second,
    because who offers is a peer-id comparison and only one of the two orderings
    was ever the visible failure. Then the harder version: move a call between
    devices twice in a row, and move it while a third person is in it. What is
    being watched for is a link that comes back late, which now happens and did
    not before, and a call that renegotiates when it did not need to, which is
    what the "only from `new`" rule exists to prevent.

36. **A picture changed on one device, on every screen of another.** Two
    accounts signed in on three clients between them - desktop or web, and the
    phone - sharing a server and a friendship. Change the avatar on one and
    watch the other, without touching anything: the member list, the message
    list of an open channel, the conversation list and the friend list must all
    take the new picture. Change the display name too, because it travels in the
    same event and is drawn in more places. Then the quoted line of a reply,
    which must *not* change - it is how the message was signed at the time.

    Then a server: rename it and give it a new icon from one client, and watch
    the rail on the other. Do this from Android as well as from the desktop, and
    do it while the other client is looking at a different server, because the
    sidebar is the case that used to need a restart.

    Last, a relaunch on the phone: the patched lists are written back to the
    cache, so a restart must not bring the old picture back.

37. **The status dot, which has never been watched go green.** Two accounts,
    friends, on two clients. Sign one in and watch the other's friends list, DM
    list and member list without touching them: each dot must go green within a
    second or two, and grey again when the first signs out. Do it on the phone's
    drawer as well - that had its own copy of the same bug. The thing to be
    suspicious of is a screen that only updates when something else on it moves,
    which is exactly what the four broken selectors looked like.
