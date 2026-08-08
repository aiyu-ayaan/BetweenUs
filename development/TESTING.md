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
- Click **lounge** under VOICE CHANNELS in one window, then in the other. Each
  window lists everyone connected, and members who have not joined still see the
  roster under the channel name.
- The panel says *Voice connected* with a padlock; without the padlock the join
  was aborted rather than downgraded to plaintext media.
- Toggle microphone, camera and screen share. Screen share picks the primary
  screen (Electron answers the picker in the main process).
- A machine with no microphone still joins - the panel just shows the mic off.

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

## Backend smoke test

`node apps/services/chat-service/smoke.mjs` walks the REST and WebSocket
surface end to end: register → refresh rotation → workspace → channel →
WebSocket subscribe → send → realtime receive → history → upload/download →
traversal blocked → E2EE device directory, key publish/fetch and epoch
ordering. It needs Postgres, Redis and the services running.

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
| Windows open on top of each other | Positions are fixed at x=40 and x=760; on a small display, drag them apart |
