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
- [x] **The notification.** `MessagingStyle`, one per channel, sender picture,
      decrypted image in the expanded view, direct reply from the shade without
      opening the app, mark-as-read, tap-through on `betweenus://channel/<id>`,
      and cleared on open and on sign-out.

Documentation:

- [x] **`FCM/`** in the repository root: the architecture and the setup in
      `README.md`, the wire format and the order of the gates in `PAYLOADS.md`,
      and what to try first in `TESTING.md`.
- [x] **Post-SFU corrections** across `TODO.md`, and phase 27 opened for push.
- [x] **This pass**, recorded here and in `ANDROID_TODO.md`.

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
- [ ] **Safety numbers**, so a lying key directory is detectable. The last of
      the E2EE three and the one with the most UI in it.
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
- [ ] **`REMOTE_FILE_TRANSFER` and `REMOTE_AUDIO`.** Both exist in the
      vocabulary and do nothing.
- [ ] **The headless `remote-agent`.** Still a scaffold. A server has no BetweenUs
      window to run the agent inside, which is what it is for.
- [ ] **Decide whether the shared UI moves to `packages/ui`.** Worth a rename
      only if a third client appears; today it would change nothing else.

### Android

- [ ] **An emoji picker and an upload screen on the phone.** It renders custom
      emoji and sends them; what it has not got is the `:` menu, the picker, and
      the settings screen that uploads one. Animating a GIF needs Coil's
      `coil-gif` artifact - one dependency line, absent from the offline cache
      when this landed.
- [ ] **The member menu**, which landed on desktop and web this pass. The shortcode table is a shared contract in
      `emoji-names.ts`; the phone has neither.
- [ ] **Markdown-ish body rendering.** `message-body.ts` is the contract.
      (Replies landed, on all three clients.)
- [ ] **Input sensitivity on the phone.** The two modes, the processing switches
      and an output route landed; the gate did not. The desktop gates the
      captured track in a Web Audio worklet, and Android's WebRTC has no
      insertion point on the capture path short of a custom audio device module.
      A level meter driving a mute toggle would be a different thing wearing the
      same name.
- [ ] **Ducking and an incoming phone call.** Two parts of the audio-focus
      problem; the third, headset routing, landed - see the Bluetooth item
      above.
- [ ] **An invite link that opens the app.** Minting, revoking and sharing a
      code landed; a deep link that joins on a tap did not, and it needs an
      app-link and a host to claim.
- [ ] **Remote clipboard and file transfer**, each gated on its own permission.
- [ ] **OAuth through Custom Tabs**, with an app-link callback, offering only
      the providers the server reports.
- [ ] **Phase 13 hardening, minus R8.** The refresh token out of plain
      `SharedPreferences` into the Keystore and keyed per deployment;
      private-CA certificate handling; a real signing config, which needs a
      keystore that is not in this repository. R8 and resource shrinking are on
      - 54.8 MB to 43.1 MB - and `assembleRelease` produces an unsigned APK
      until that keystore is configured, which is the correct default: a
      signing key belongs to whoever ships the app.
- [ ] **Instrumented tests and CI**, opt-in crash reporting, and a light theme.

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
