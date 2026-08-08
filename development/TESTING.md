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
| Alice | `alice@nexora.local` | workspace owner |
| Bob | `bob@nexora.local` | member |

Password for both: `nexora-dev-1`. They share the workspace **Duo Test**, its
`#general` text channel and its **lounge** voice channel.

What the script does:

1. Health-checks auth-, workspace- and chat-service, and refuses to start if
   any of them is down (it warns, but continues, when only call-service is).
2. Registers the two accounts, or signs in if they already exist, creates the
   workspace and joins Bob to it. Re-running is harmless.
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
- Both windows show a green `E2EE` badge in the channel header.

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
surface end to end: register → refresh rotation → workspace → channel →
WebSocket subscribe → send → realtime receive → history → upload/download →
traversal blocked → E2EE device directory, key publish/fetch and epoch
ordering.

`node apps/services/presence-service/smoke.mjs` connects two authenticated
sockets and asserts the handshake, `presence.sync`, online and offline fanout,
typing (including that it is not echoed to its author), the voice roster on
join and leave, the heartbeat, a rejected anonymous socket and a refused
non-member voice join.

## Self-checks and CI

`pnpm check` runs the package self-checks with no infrastructure at all: the
crypto primitives, storage, logger redaction, the desktop E2EE round trip, and
`AuthService` against an in-memory database (register, login, refresh rotation,
reuse detection, logout).

`.github/workflows/ci.yml` runs those on every pull request, then a second job
that starts Postgres and Redis, applies migrations, boots auth-, workspace-,
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
