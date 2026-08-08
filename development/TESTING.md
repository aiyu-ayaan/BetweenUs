# Testing chat and calls locally

Two users are needed to test anything real: a message has a receiver, a call has
a second participant, and end-to-end encryption only means something when the
key was exchanged between two separate devices.

## `pnpm dev:duo`

```bash
pnpm dev:infra          # Postgres, Redis, LiveKit
pnpm db:migrate         # first run only
pnpm dev                # backend services (leave running)
pnpm dev:duo            # in a second terminal
```

Docker runs inside WSL on some machines; `pnpm dev:infra` then has to run from
the WSL shell, while `pnpm dev` and `pnpm dev:duo` stay on Windows.

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

## Backend smoke tests

Both scripts need Postgres, Redis and the services running, and both exit
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

`node apps/services/presence-service/smoke.mjs` connects two authenticated
sockets and asserts the handshake, `presence.sync`, online and offline fanout,
typing (including that it is not echoed to its author), the voice roster on
join and leave, the heartbeat, a rejected anonymous socket, a refused
non-member voice join, and status: that a chosen status reaches the other
socket, that invisible reaches it as `offline`, and that the word `invisible`
never appears in anyone else's payload.

## Self-checks and CI

`pnpm check` runs the package self-checks with no infrastructure at all: the
crypto primitives, storage (including a multipart round trip and the sweep for
abandoned uploads), logger redaction, the desktop E2EE round trip, the message
body encoding that carries attachment manifests, and `AuthService` against an
in-memory database (register, login, refresh rotation, reuse detection,
logout).

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
