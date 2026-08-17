# Nexora — the current track

One ordered list of the work accepted for this pass, kept apart from `TODO.md`
so that document can go back to being what it is: the record of how each phase
got to where it is, and the backlog of everything anyone has ever thought of.

This is narrower. It is the set of items chosen to be built now, and nothing
else joins it without being chosen. **Push notifications are deliberately not
here** - FCM, Web Push, the shared device registry and the two Android features
that wait behind them are phase 27 in `TODO.md`, and are the next major phase
rather than part of this one.

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
- [x] **A channel opened wherever the last one was.** The list scrolled on
      `messages.length`, and two channels holding the same number of messages
      change neither the length nor the offset. It scrolls on the newest message
      id now, jumps without animation on open, follows only from the bottom, and
      stays pinned while attachments decrypt underneath it.

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

Documentation:

- [x] **Post-SFU corrections** across `TODO.md`, and phase 27 opened for push.

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
- [ ] **The headless `remote-agent`.** Still a scaffold. A server has no Nexora
      window to run the agent inside, which is what it is for.
- [ ] **Decide whether the shared UI moves to `packages/ui`.** Worth a rename
      only if a third client appears; today it would change nothing else.

### Android

- [ ] **Markdown-ish body rendering.** `message-body.ts` is the contract.
      (Replies landed, on all three clients.)
- [ ] **Input sensitivity on the phone.** The two modes, the processing switches
      and an output route landed; the gate did not. The desktop gates the
      captured track in a Web Audio worklet, and Android's WebRTC has no
      insertion point on the capture path short of a custom audio device module.
      A level meter driving a mute toggle would be a different thing wearing the
      same name.
- [ ] **Ducking and an incoming phone call.** Two parts of the audio-focus
      problem; the third, headset routing, landed with the route picker.
- [ ] **An invite link that opens the app.** Minting, revoking and sharing a
      code landed; a deep link that joins on a tap did not, and it needs an
      app-link and a host to claim.
- [ ] **Remote clipboard and file transfer**, each gated on its own permission.
- [ ] **OAuth through Custom Tabs**, with an app-link callback, offering only
      the providers the server reports.
- [ ] **Phase 13 hardening.** The refresh token out of plain `SharedPreferences`
      into the Keystore and keyed per deployment; private-CA certificate
      handling; R8 and a release signing config.
- [ ] **Instrumented tests and CI**, opt-in crash reporting, and a light theme.

---

## Nothing here has been in front of a human

Every landed item above is typecheck-and-self-check confidence and nothing more.
No backend has been run in the session that wrote them, so the smoke scripts
changed along the way - presence scoping in `presence-service/smoke.mjs`,
invites in `chat-service/smoke.mjs` and `notification-service/smoke.mjs` - have
been syntax-checked and not executed.

**Three migrations are waiting, and two of their names sort backwards.**
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
17. The join and leave tones with three people in a call, which is where the
    two failure modes live: joining a channel that already has two people in it
    must play one tone and not two, and nobody should hear a tone for a peer
    connection that merely reconnected. Worth listening to on a headset plugged
    in mid-call as well - on the phone the tone follows the call's route, and
    an arrival in the earpiece while the call is elsewhere is the bug that
    would show.

`TESTING.md` is the fuller version of this list and predates it.
