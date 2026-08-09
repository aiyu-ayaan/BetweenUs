# Testing chat and calls locally

Two users are needed to test anything real: a message has a receiver, a call has
a second participant, and end-to-end encryption only means something when the
key was exchanged between two separate devices.

## `pnpm dev:duo`

```bash
pnpm dev:infra          # Postgres, Redis, LiveKit
pnpm db:migrate         # first run only
pnpm dev:backend        # backend services only (leave running)
pnpm dev:duo            # in a second terminal
```

Use `pnpm dev:backend`, not `pnpm dev`: the second one also starts the desktop
renderer on 5173, and `dev:duo` starts its own Vite there for the two windows
to share. The symptom is `Port 5173 is already in use`.

Docker runs inside WSL on some machines; `pnpm dev:infra` then has to run from
the WSL shell, while `pnpm dev:backend` and `pnpm dev:duo` stay on Windows.

`dev:duo` opens **two Electron windows side by side, each already signed in**:

| Window | Account | Role |
| --- | --- | --- |
| Alice | `alice@nexora.local` | server owner |
| Bob | `bob@nexora.local` | member |

Password for both: `nexora-dev-1`. They share the server **Duo Test**, its
`#general` text channel and its **lounge** voice channel. Alice also owns
`#owners-only`, a private channel Bob is deliberately not on, and the two of
them start as friends with a direct message already open.

What the script does:

1. Health-checks auth-, server- and chat-service, and refuses to start if
   any of them is down (it warns, but continues, when only call-service is).
2. Registers the two accounts, or signs in if they already exist, creates the
   server and joins Bob to it, creates the private channel, makes them friends
   and opens their conversation. Re-running is harmless.
3. Starts the Vite dev server **once**.
4. Launches two Electron processes with `NEXORA_PROFILE=duo-a` / `duo-b`, so
   each window gets its own user-data directory — its own session, its own
   `localStorage`, and its own E2EE device key. Sharing a profile would defeat
   the point of the test.

Closing both windows stops the dev server. Ctrl+C does the same.

## What to try

**Chat**
- Type in Alice's window; it appears in Bob's within a moment. The row in
  Postgres is a ciphertext envelope — check with `pnpm db:studio`.
- There is no encryption badge in the header, by design: it is on for
  everything, so saying so in every channel says nothing. See `E2EE.md`.

**Attachments**
- Drag a photo onto the composer, or paste a screenshot. It uploads with a
  progress line, appears inline in both windows, and clicking it opens the
  full-size view. The object in `storage-data` is ciphertext — open it and it
  is not a PNG, which is the point.
- Send a file with no preview - a `.zip`, an `.exe`, anything. It arrives as a
  card with a download, and the response headers say `application/octet-stream`
  and `attachment`, whatever the file really is.
- Paste more than 2000 characters and send. It arrives as `message.txt` with
  the first lines shown and an expand, not as a truncated message.
- Something over 8 MB uploads in parts: the progress line moves in steps rather
  than jumping to 100.

**Profile pictures**
- User settings → My Account → *Upload avatar*. It shows up in Alice's own
  panel, and in the member list and message rows in Bob's window after his
  client next reads the member list. **Remove** puts the initial back.
- Server settings → Overview → *Upload server icon*. The rail pill becomes the
  picture in both windows.
- Unlike everything else, these are stored in the clear and served inline — the
  file in `storage-data/pictures` opens in an image viewer. That is deliberate
  and documented in `E2EE.md`.

**Private channels**
- Alice's sidebar lists `#owners-only` with a padlock. Bob's sidebar does not
  list it at all — not greyed out, absent — and that holds however senior he is
  made, because the allowlist is the whole rule.
- Create another one from the **+** beside TEXT CHANNELS: tick *Private
  channel*, pick Bob, and it appears in his sidebar within a reload. Untick him
  again in Server settings → Channels and it goes.

**Direct messages and friends**
- Click the Nexora button at the top of the rail in either window: the home
  screen opens, with **Friends** and the conversation with the other person.
- Send from Alice's DM; it lands in Bob's, notification and unread count
  included, because a DM is a channel and nothing about it is special.
- Friends → **Add friend** searches by username. Send a request from a third
  account and watch the **Pending** tab count it in the other window.
- Try to open a DM with somebody who is not a friend: the server refuses it
  (`NOT_FRIENDS`), which is the rule that keeps search from being a spam
  surface.
- A request, an acceptance and a removal all land in the other window without a
  reload: the server sends `friends.changed` to both sides and each client
  re-reads its list. Remove the friend in Alice's window and watch Bob's
  Friends screen empty itself.

**The message menu**
- Right-click any message: react with one of six emoji or open the full picker,
  edit (your own), pin, copy the text, delete. There is no hover bin any more.
- Delete takes two clicks — the first arms the item, the second does it.
- Delete your own message: both windows show *Message deleted* where it was.
  Delete somebody else's as a moderator and theirs reads *Message deleted by
  NAME*. The row survives in Postgres with `deletedAt` set and an empty
  `content`, so the tombstone costs no ciphertext.
- A plain MEMBER gets no Delete on somebody else's message; give yourself
  *Delete anyone's messages* in Server settings → Roles & Permissions and it
  appears.

**Editing**
- Edit one of your own: the message turns into a box, Enter saves, Escape
  cancels. It shows *(edited)* afterwards, in both windows.
- The other window cannot edit yours — there is no Edit item on somebody else's
  message, and the server refuses it anyway (`NOT_MESSAGE_AUTHOR`).

**Reactions and emoji**
- React from the menu, or from the smiley beside an existing chip. The chip
  counts up in both windows; clicking your own chip takes the reaction back.
- The smiley in the composer inserts an emoji where the caret is, not at the
  end.
- Reactions are the one thing the server can read — see limit 9 in `E2EE.md`,
  and the `message_reactions` rows in `pnpm db:studio`.

**Pins and search**
- Pin a message from the menu, then open the pin icon in the channel header: the
  right-hand column becomes the pinned list in place of the member list.
  Clicking a pin scrolls the conversation to it and flashes it.
- As a plain MEMBER the Pin item is greyed out and says which permission it
  wants; grant *Pin and unpin messages* in Server settings → Roles &
  Permissions and it becomes live in the other window within a moment - no
  restart, because the grant is announced and the client re-reads what it may
  do. In a direct message either person can pin —
  there are no roles in a DM.
- Anything the server refuses - a pin, a delete, a reaction - now says so in a
  red line at the top of the conversation instead of doing nothing.
- The magnifier in the header opens search over the messages that window has
  decrypted; the footer says how many that is. It has to work this way: the
  server holds ciphertext and cannot search it.

**Unread counts and the new-messages line**
- With `#general` open in Alice's window, click Bob's window so Alice's loses
  focus, and send. Alice's sidebar counts 1 and a red **New** line appears above
  the message. Click back into Alice's window: the badge clears at once and the
  line clears about five seconds later — long enough to see where you left off,
  and without having to leave the channel and come back.
- Switch Alice to `#owners-only` and back: no line, because everything has been
  read.
- Send while Alice's window is focused and `#general` is open: no badge, no
  line, and no badge after a restart either — the read marker moved with it.
- The badge that used to stick: a message arriving in the channel already on
  screen while the window was in the background counted and never cleared,
  because only opening a channel cleared a count.

**Focus**
- Click into the composer, or on a server pill: no blue box anywhere, including
  Chromium's own outline on the rail pill. Tab around with the keyboard and a
  thin neutral ring follows the focus - except on the rail, where the bar on the
  left edge of the pill is the marker.

**Adding people to a server**
- Server settings → Members → *Add a member*: type a username, and the same
  directory search the Friends screen uses offers matching people. Anyone
  already in the server is left out of the results.
- Add Bob from Alice's window and his rail grows the server without a restart:
  `server.members.changed` reaches whoever it was about as well as everyone
  watching the server.
- Kick him again and it vanishes from his rail. If he had that server open, it
  closes rather than leaving channels he can no longer read on screen.
- A MEMBER without *Manage members* gets `MISSING_PERMISSION`; the form is only
  drawn for someone who holds it, and the server checks anyway.

**Roles and permissions**
- Server settings → Roles & Permissions, pick Bob, set **Send messages** to
  *Deny*. His composer still draws, but the send is refused by chat-service —
  authorization is the server's, never the UI's.
- Set **Create and manage channels** to *Allow* while leaving him a MEMBER: the
  **+** appears beside his channel headings.
- Bob cannot promote himself: the member editor refuses a role at or above the
  editor's own, and refuses to grant a permission the editor does not hold.

**Status**
- Click your own avatar at the bottom of the sidebar and choose **Invisible**.
  Your own window keeps showing you as invisible; the other window shows you as
  offline, and `presence.changed` on the wire says `offline` too — check with
  the presence smoke script, which asserts exactly that.

**Voice channels**
- Click **lounge** under VOICE CHANNELS in one window, then in the other. The
  first click joins the call and opens the channel screen; clicking it again
  only reopens the screen, it does not rejoin.
- The channel screen shows a tile per participant - camera or shared screen when
  there is one, the initial otherwise, with a green ring while that person is
  speaking. Switch to `#general` and back: the call keeps running, because the
  connection lives in the store, not in the screen.
- Open a voice channel nobody is in and the screen reads *No one is currently in
  voice* with a **Join Voice** button.
- The sidebar panel says *Voice connected* with a padlock; without the padlock
  the join was aborted rather than downgraded to plaintext media.
- Toggle microphone and camera from either the sidebar panel or the bar under
  the channel screen - both drive the same store, so they always agree.
- A machine with no microphone still joins - the panel just shows the mic off.

**Screen share and watching together**
- The screen button opens a picker: **Screens** and **Applications** tabs with
  live thumbnails, and a *Share system audio* checkbox that is only enabled on
  Windows. Double-clicking a thumbnail shares it; Escape closes.
- Sharing does not replace your camera tile - both are live at once. Your own
  window shows the preview; the other window gets a banner reading *bob is
  sharing a screen* with **Join stream**, and stays in the grid until it is
  pressed.
- **Join stream** opens the theatre: the screen fills the stage, the faces move
  to a strip underneath. *Back to grid* leaves it without stopping the share;
  *Stop sharing* ends it for everyone.
- With system audio on Windows, sound from the shared window is heard in the
  other window - that is the movie-night path, and it rides the same encrypted
  session as the voice.
- Speaking is marked amber on the tile. With more than nine people the grid
  pages, and whoever spoke last minute is pulled onto page one.

**Notifications**
- Send from one window while the other is on a different channel, or not
  focused: the other raises a desktop notification and its taskbar entry
  flashes. Clicking the notification brings that window forward and opens the
  channel the message was in.
- A channel with unread messages shows a count in the sidebar; opening it
  clears the count.
- Join **lounge** from one window while the other is elsewhere: the other is
  notified that someone joined the voice channel. Nobody is notified about
  their own join, or about a channel they are already sitting in.
- No notification arrives for the channel that is open in a focused window -
  that is the rule, not a missing event.

**Presence and typing**
- The member list shows a green dot per online member; close one window and the
  other greys that member out within a moment.
- Type in one window and the other shows "… is typing" above its composer.

**Key exchange**
- The first window to open the channel mints the channel key and seals it for
  every member. The second unwraps it.
- Delete the profile directory (`%TEMP%\nexora-duo-b`) and reopen: Bob's window
  generates a new device key and old messages show the "no key on this device"
  placeholder — that is the design, not a bug (see `E2EE.md`, limit 1).

## Pointing the client at another server

The address in the build is a default, not a decision, so this is worth driving
by hand once.

1. **The address is on screen.** The login screen says which deployment it is
   signing in to, under "Connect to a self-hosted instance". In `pnpm dev` that
   is `localhost:5173` - the Vite dev server proxies to the services, so its own
   origin is the gateway.
2. **A wrong address fails politely.** Open the dialog, type `nope.example.com`,
   Connect. It should say it could not reach that address, and the window should
   still be where it was. Type a host that answers but is not Nexora (any web
   site) - "That address is not a Nexora server".
3. **A right one switches.** With the container stack up, type `localhost:8080`.
   The window signs out, reloads, and signs in against Nginx instead of the Vite
   proxy. Voice then goes through `/livekit` rather than straight at 7880, which
   is the path a real deployment takes.
4. **Back again.** The dialog offers the build's own address when the window is
   somewhere else; it is also reachable from Settings → My Account → Server.
5. **Only one variable.** `VITE_API_URL` in the repo-root `.env`, empty for
   development. There is no `VITE_WS_URL` any more - if something asks for one,
   it is out of date.

## Notifications, the tray and auto-start

Most of this needs a packaged build (`pnpm --filter @nexora/desktop build`
then electron-builder), because a development window deliberately refuses to
register itself to start with the system.

1. **Muting.** Open a channel, click the bell in its header. Have the other
   window send to it - no notification, and the bell reads as muted. Sign in on
   another machine (or wipe the profile and sign in again): still muted, because
   the setting is on the account, not the window.
2. **Quiet hours.** Settings → Notifications → Quiet hours, set a window that
   contains the current time. Nothing is raised until it passes. Set one that
   crosses midnight and check the boundary either side.
3. **Do Not Disturb.** Set the status from the user panel; notifications stop
   until it changes.
4. **Unread survives a restart.** Leave messages unread, quit, sign in again -
   the sidebar dots and the tray tooltip come back with the same counts. Open
   the channel and they clear on the account, not only in this window.
5. **Close to tray.** Close the window. The process stays up, the tray icon
   stays there, and a message arriving now still raises a notification.
   Clicking the tray icon brings the window back; Quit on its menu ends it.
6. **Start with the system.** On in settings by default. Reboot: Nexora comes
   back in the tray with no window in front of what you were doing. Turn it off
   and reboot again - it stays gone.

## Backend smoke tests

The scripts need Postgres, Redis and the services running, and both exit
non-zero on a failed assertion — CI runs exactly these.

`node apps/services/chat-service/smoke.mjs` walks the REST and WebSocket
surface end to end: register → refresh rotation → server → channel →
WebSocket subscribe → send → realtime receive → history → traversal blocked →
E2EE device directory, key publish/fetch and epoch ordering.

For uploads it asserts what can actually break now that files are ciphertext:
an attachment round-trips byte for byte and is never served inline, a multipart
upload assembles in part order however the parts arrived, an upload ticket is
refused for an account that did not open it, the scratch space parts live in is
not downloadable, an SVG is refused as a profile picture, and an avatar URL
pointing at somebody else's host is refused.

It then brings in a second account and asserts the phase 12 rules: that
`MANAGE_CHANNEL` is enforced, that granting it to one member takes effect and
denying `SEND_MESSAGE` is honoured by chat-service, that a private channel is
absent from a non-member's listing and its history refused, that a direct
message is refused between strangers and allowed between friends, that opening
the same conversation twice reuses one channel, and that a message sent in it
arrives.

Phase 15 adds the social and realtime rules to the same script: an author
deletes their own message, a stranger cannot delete somebody else's until
`DELETE_MESSAGE` is granted, a deleted message leaves history and a second
delete answers 404; a member is added by username, adding them twice is
idempotent, adding without `MANAGE_MEMBER` is refused and an unknown username
is not found; removing a friend takes the right to reopen the conversation with
them. It then holds a second socket open and asserts the fanout itself -
`message.deleted` in the channel, `friends.changed` at the other side of the
friendship, `server.members.changed` at everyone watching the server, and a
`server.subscribe` from somebody no longer in it refused with
`SERVER_FORBIDDEN`.

Phase 15b adds the message actions: an author edits their own message and
`editedAt` is stamped while a second account is refused, pinning works in a
direct message for either participant and needs `MANAGE_MESSAGE` in a server
channel, the pin list shows it and unpinning clears it, a reaction toggles on
and off through one endpoint and a sentence is refused as an emoji, and a
deletion returns a tombstone - unattributed for the author, naming the moderator
otherwise. The same second socket asserts that a deletion, an edit and a
reaction each arrive as `message.updated` carrying the changed message.

`node apps/services/presence-service/smoke.mjs` connects two authenticated
sockets and asserts the handshake, `presence.sync`, online and offline fanout,
typing (including that it is not echoed to its author), the voice roster on
join and leave, the heartbeat, a rejected anonymous socket, a refused
non-member voice join, and status: that a chosen status reaches the other
socket, that invisible reaches it as `offline`, and that the word `invisible`
never appears in anyone else's payload.

`node apps/services/notification-service/smoke.mjs` covers preferences and
read state: the preference round trip with the mute list deduplicated, a patch
that leaves untouched fields alone, a minute outside the day refused, your own
message never unread, someone else's counted, history from before you joined
not counted, the read marker clearing the count, a channel you cannot see
answering 404 rather than 403, and an anonymous caller refused.

## Self-checks and CI

`pnpm check` runs the package self-checks with no infrastructure at all: the
crypto primitives, storage (including a multipart round trip and the sweep for
abandoned uploads), logger redaction, the desktop E2EE round trip, the message
body encoding that carries attachment manifests, the server-address parsing
behind the login screen's server picker, and `AuthService` against an in-memory
database (register, login, refresh rotation, reuse detection, logout).

`.github/workflows/ci.yml` runs those on every pull request, then a second job
that starts Postgres and Redis, applies migrations, boots auth-, server-,
chat- and presence-service and runs both smoke scripts.

## Admin panel

```bash
pnpm admin:create        # prints a username and a generated password, once
pnpm dev:admin           # http://localhost:5174/admin/
```

Worth walking through:

- Before `pnpm admin:create` has ever run, the panel refuses to show a form and
  names the command instead. (`GET /api/v1/admin/status` answers `hasAdmin`.)
- The first login lands on "Choose a password" and nothing else is reachable
  until it is done - the admin API answers `PASSWORD_CHANGE_REQUIRED`.
- Users: search, promote, demote, disable, enable, delete. The last enabled
  administrator cannot be demoted, disabled or deleted, and nobody can demote or
  delete themselves.
- Sign-in providers: enabling without a client secret is refused. With both
  fields filled and the switch on, the desktop login screen shows the provider
  button on its next load; switching it off removes it.
- My account: change username, display name and password. Changing the password
  signs other sessions out and keeps this one.

Lost the password: `pnpm admin:create --reset` issues a new one and revokes the
sessions the old one left behind.

## Testing the container stack

```bash
docker compose -f infrastructure/docker/docker-compose.yml up -d --build
curl 127.0.0.1:8080/health
```

Everything runs in containers behind Nginx on `8080`, migrations included, so
this is the path that catches what host development hides: image builds,
service-name networking and gateway routing. Stop the dev stack first — both
bind the same host ports.

Renderer output from both windows is mirrored into the terminal that ran
`pnpm dev:duo`, prefixed with `[renderer Alice]` / `[renderer Bob]`. In
development that includes LiveKit's own debug log, so a failed publish shows
its negotiation and ICE steps rather than one summary line.

Server-side state is worth checking directly when something looks wrong:

```bash
docker exec nexora-dev-redis redis-cli zrange presence:online 0 -1
docker exec nexora-dev-redis redis-cli keys 'presence:voice:*'
docker logs nexora-dev-livekit --since 5m | grep mediaTrack
```

A published track logs `"encryption":1` — that is the end-to-end encrypted path.

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| `call-service is down` warning | `pnpm dev` not running it, or `LIVEKIT_*` unset in `.env` |
| Join fails with "Failed to fetch" | `LIVEKIT_URL` points at `localhost`; use `127.0.0.1`, because Chromium tries `::1` first and the container publishes IPv4 only |
| Join fails against a deployment behind Nginx | `LIVEKIT_URL` should be `/livekit` there, not a host - the client resolves it against the address it is already on |
| Voice connects, no audio or video | LiveKit UDP ports 50000-50019 not published; check `docker compose -f infrastructure/docker/docker-compose.dev.yml ps` |
| No online dots or typing indicators | presence-service is down; `curl 127.0.0.1:3005/health` |
| "microphone did not start (negotiation timed out)", and the mic/camera/screen buttons then fail too | The LiveKit container is older than `livekit-client` expects, so it never acknowledges a publisher offer. `docker compose -f infrastructure/docker/docker-compose.dev.yml up -d livekit` to pull the pinned v1.13.5 |
| Voice churns: join, leave, join again | Editing desktop source while connected. A hot reload disconnects the room on purpose; rejoin after the reload |
| Messages show the lock placeholder | This device has no key for that epoch — a member holding it must open the channel once to re-wrap |
| Provider buttons missing on the login screen | Nobody enabled a provider in the admin panel, or its client id/secret is incomplete |
| OAuth ends on a browser error page | `PUBLIC_API_URL` does not match the callback URL registered with Google or GitHub |
| Admin panel says no administrator exists | `pnpm admin:create` has not been run against this database |
| Windows open on top of each other | Positions are fixed at x=40 and x=760; on a small display, drag them apart |
| Login answers 429 | The per-address credentials limit (20/min) kicked in; wait out the window |
| Signed out of every window at once | A refresh token was replayed, which revokes the whole family. Usually two clients sharing one token — check for a stale profile directory |
