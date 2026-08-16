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
- [x] **Admin: audit log, paged users table, OAuth for the panel.** The trail is
      append-only and keeps a label for a target that no longer exists; paging
      is a cursor, so a registration between two requests cannot repeat a row;
      the panel's own login now offers whichever providers are switched on.

Desktop and web:

- [x] **Per-person volume and mute.** Per machine, keyed by user id; a muted
      person plays at zero so unmuting is instant.
- [x] **Push to talk.** `enabled` on the raw capture, so nothing renegotiates.
      Window-scoped: `globalShortcut` reports a press and never a release.
- [x] **Call statistics.** Bitrate, loss, round trip and frame size per peer,
      plus a "nobody can hear you" warning that does not hide behind a button.
- [x] **Private-channel allowlist editing.** "Who is on it" in server settings,
      re-keying the channel on save.

Documentation:

- [x] **Post-SFU corrections** across `TODO.md`, and phase 27 opened for push.

---

## Open

Ordered within each group, roughly by what unblocks the most. Nothing here is
blocked by anything outside this document.

### Backend

- [ ] **Remote sessions over Redis Pub/Sub.** Sessions are relayed in one
      process's memory, so agent and controller must land on the same instance -
      true for the single replica compose runs, not for two. Keyed by session id.
- [ ] **Custom named roles with a colour and an ordering.** The five built-ins
      plus per-member overrides are what exists; this is a table, a rank, and
      the permission editor learning to read it.
- [ ] **Attachment blobs swept when their message is deleted.** Needs an
      attachment row per upload first: the manifest naming the blobs is inside
      the encrypted body, so no service can tell which blob belongs to which
      message. The alternative is the deleting client removing what it can read,
      which leaves anything deleted by a moderator behind.
- [ ] **Multi-device E2EE.** A key list per user, one wrap per device, so a
      device can be revoked without rotating the account identity. What exists
      copies one identity to every machine.
- [ ] **Identity rotation after a lost device**, re-sealing current channel keys
      for the new identity. Depends on the item above being the shape it wants.
- [ ] **Safety numbers**, so a lying key directory is detectable. The last of
      the E2EE three and the one with the most UI in it.
- [ ] **Split the shared Prisma schema per service, and stand up
      `user-service`.** The largest single item on this list and the one with
      the widest blast radius; profiles, avatars and friends are served by
      chat-service today.

### Desktop and web

- [ ] **Modifier chords.** Keys travel one at a time on both the remote path and
      the give-control-in-a-call path, so Ctrl+Alt+Del is not delivered as a
      chord. One change, two callers.
- [ ] **Manual quality override** for a share and for a remote session. There is
      no "use 20 Mbps" and no way to force a codec, so a LAN cannot be told it
      is a LAN - everything is inferred from congestion control.
- [ ] **Display hot-plug noticed mid-session.** The display list is read once
      when a session opens; a monitor plugged in - or one that changes
      resolution - is not noticed until the next session.
- [ ] **Per-session input targets.** One input target for the whole process, so
      a machine in a remote session *and* handing control out in a call points
      both at whichever was set last.
- [ ] **An unread line that survives a restart, and a jump to it.** The read
      marker survives; the line is only placed when a channel is opened in this
      session.
- [ ] **Edit history, encrypted reactions, paged search, who-reacted names, a
      pinned panel that pages.** Five separate message-side gaps, listed
      together because they are one screen's worth of work each.
- [ ] **A light theme.** The ramp is defined once, which is what makes one
      possible; nothing else about it has been designed.
- [ ] **Decrypted history persisted under a device key.** Cached in memory per
      channel today, so it is gone after a restart. Persisting plaintext is what
      the encryption is for, so it has to be sealed at rest.
- [ ] **Chunked AEAD attachments, and a video transcode.** The first lifts the
      100 MB ceiling; the second means ffmpeg in the client.
- [ ] **A recent-servers list, and a client/server version check.** One address
      is remembered, not a history; a client too old for a deployment finds out
      through a failing request.
- [ ] **Input injection on macOS and Linux.** CGEventPost and XTEST/uinput, one
      backend each behind the same three-function interface.
- [ ] **`REMOTE_FILE_TRANSFER` and `REMOTE_AUDIO`.** Both exist in the
      vocabulary and do nothing.
- [ ] **The headless `remote-agent`.** Still a scaffold. A server has no Nexora
      window to run the agent inside, which is what it is for.
- [ ] **Decide whether the shared UI moves to `packages/ui`.** Worth a rename
      only if a third client appears; today it would change nothing else.

### Android

- [ ] **Replies, and markdown-ish body rendering.** The desktop has both;
      `message-body.ts` is the contract for the second.
- [ ] **Reconnect driven by a network-change callback**, rather than waiting for
      the backoff timer to come round.
- [ ] **Audio device and input-sensitivity settings.** The desktop's two modes,
      device pickers and gate threshold, on a phone.
- [ ] **Ducking, an incoming phone call, and headset routing** - including a
      route picker. Three parts of the same audio-focus problem.
- [ ] **The share quality ladder**, mirroring `share-quality.ts`.
- [ ] **Invite management on the phone.** Minting one with an expiry and a use
      limit, revoking it, and a link that opens the app. The API client already
      has the three calls; there is no screen. (Joining with a code and creating
      a server both landed with the invites work.)
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

The cases most worth putting a person in front of, in order:

1. `pnpm dev:duo`, two accounts, one voice channel: per-person volume, push to
   talk, and the connection panel. Push to talk and the statistics are the two
   that can look right and be wrong.
2. An invite: mint one with a use limit, spend it, watch the second person be
   refused, then revoke another and watch that refused too.
3. A private channel: remove somebody from "Who is on it" and confirm they stop
   being able to read what is sent afterwards.
4. Two accounts on different servers, signed in at once: neither should see the
   other's presence at all.
5. The container stack end to end, which has still never been run.

`TESTING.md` is the fuller version of this list and predates it.
