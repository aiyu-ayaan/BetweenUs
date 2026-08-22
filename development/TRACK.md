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

- [ ] **Input sensitivity on the phone.** The two modes, the processing switches
      and an output route landed; the gate did not, and this is the one item on
      the list blocked by the platform rather than by time. The desktop gates
      the captured track in a Web Audio worklet, and Android's WebRTC has no
      insertion point on the capture path short of a custom audio device
      module. A level meter driving a mute toggle would be a different thing
      wearing the same name.
- [ ] **Remote file transfer**, gated on `REMOTE_FILE_TRANSFER`. Blocked on a
      wire that does not exist anywhere: the gateway has no file message, the
      desktop agent has nothing that would receive one, and a remote session
      negotiates a video track and no data channel. The permission does nothing
      on every client, which is why this sits beside the desktop's own entry
      rather than under Android alone. The clipboard, which shares the item it
      used to be half of, landed - see below.
- [ ] **A light theme on the phone**, which is the same item the desktop has and
      is open for the same reason: the ramp is forty top-level constants used
      directly by thirty-five files, and nothing about a light BetweenUs has
      been designed.

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

