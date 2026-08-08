# Nexora Development Planning

Living document. `CLAUDE.md` is the target architecture; this file records how
we get there in stages and what each stage delivers.

## Phase map

| Phase | Name | Delivers | Status |
| --- | --- | --- | --- |
| 0 | Scaffold | Monorepo, workspaces, empty service folders | Done |
| 1 | Dev infrastructure | Postgres + Redis via Docker Compose, env template | Done |
| 2 | Shared packages | shared-types, config, logger, auth, permissions, events, database (Prisma) | Done |
| 3 | Auth service | Register, login, refresh rotation, `/me`, `/health` | Done |
| 4 | Workspace service | Workspaces, members, channels | Done |
| 5 | Chat service | Message REST + WebSocket gateway + Redis fanout | Done |
| 6 | Gateway | Nginx REST/WebSocket routing, rate limits, prod compose | Done |
| 7 | Desktop client | Electron + React + Tailwind + Zustand, end-to-end chat | Done |
| 8 | Encrypted chat + voice | E2EE messages, LiveKit voice channels, two-window dev harness | Done |
| 9 | Presence | presence-service, online status, typing indicators, voice rosters | Done |
| 10 | Hardening | Tests, CI, error contract polish, request IDs everywhere | Next |
| 11 | Remote desktop | remote-gateway, remote-agent, remote permissions, audit log | Planned |
| 12 | Production ingress | Cloudflare Tunnel, TLS, secret management, deploy pipeline | Planned |

Hardening moved to phase 10: encryption changes the message format and presence
adds a service, so both were cheaper to land before tests were written against
the older shape.

## Architecture decisions made so far

- **One Prisma schema in `packages/database` for the MVP.** Per-service
  databases are the target, but three services against one schema keeps the MVP
  diff small. Splitting is a migration, not a rewrite: each service already
  accesses only the models it owns.
- **Redis Pub/Sub for chat fanout.** Chat WebSocket gateway publishes to
  `chat.message.created` and every instance re-broadcasts to its local sockets.
  This makes `chat-service` horizontally scalable from day one.
- **JWT verified locally in every service** using `@nexora/auth`, no auth
  round-trip per request. Access tokens are short-lived (15m), refresh tokens
  are stored hashed in Postgres and rotated on use.
- **Storage driver chosen by environment, local disk by default.** A developer
  should not need MinIO or an AWS account to upload a file, so an empty S3
  config means local disk under `LOCAL_STORAGE_PATH`. Production sets the S3
  variables and the same code path uses the bucket.
- **Nginx as internal gateway**, no business logic. Cloudflare Tunnel is a
  separate, later concern (phase 12).
- **Media never passes through NestJS.** `call-service` mints LiveKit access
  tokens and nothing else; the desktop client dials the SFU directly.
- **One channel key, shared by chat and voice.** A member who can read a channel
  can join its voice room, so a second key exchange for media would add code and
  no security. Design and limits: `E2EE.md`.
- **Voice is a channel type, not a button on a text channel.** Discord's model:
  `VOICE` channels are joined and show who is inside, so presence answers "who
  is in there" without anyone joining first. The earlier per-text-channel call
  button was removed.
- **Presence is its own service.** `presence-service` owns `/ws/presence`,
  keeps online/typing/voice state in Redis and fans changes out over Pub/Sub.
  Typing and voice rosters could have ridden the chat socket, but presence is a
  separate concern with a separate lifecycle, and the architecture already
  reserved the service.
- **LiveKit is dialled on `127.0.0.1`, not `localhost`.** Chromium resolves
  `localhost` to `::1` first and the container publishes IPv4 only, so the
  client silently failed to reach the SFU.
- **Ciphertext lives in `messages.content`.** Encryption needed no schema change
  for messages and no service change beyond the size limit, because the server
  already treated the body as an opaque string.
- **The E2EE key directory lives in `chat-service`.** Device public keys are
  user-level data and belong in `user-service` once it exists; putting them in
  chat-service kept this to one module, one Nginx route and one client service.
  Same class of shortcut as the shared Prisma schema.

## Running the stack

```bash
cp .env.example .env
docker compose -f infrastructure/docker/docker-compose.dev.yml up -d
pnpm install
pnpm db:generate && pnpm db:migrate
pnpm dev
```

Desktop app: `pnpm --filter @nexora/desktop dev`.

Two signed-in windows for testing chat, voice and presence: `pnpm dev:duo` —
see `TESTING.md`.

## Verification status (as of phase 9)

Run live against Docker (Postgres, Redis, LiveKit in WSL) on 2026-08-08:

- `pnpm build`, `pnpm typecheck` and `pnpm check` pass across every workspace
  task, including the desktop crypto self-check.
- `20260808150000_e2ee_keys` applied to a real Postgres; `device_keys` and
  `channel_keys` exist.
- `apps/services/chat-service/smoke.mjs` passes end to end, including the E2EE
  section: device directory, key publish/fetch, and epoch-ordering rejection.
- `pnpm dev:duo` opens two signed-in windows; both reach chat and presence.
- **Encrypted chat between two clients works**: Alice and Bob exchanged
  messages, and `channel_keys` holds one wrapped key per member (epoch 1,
  sealed by Alice) while `messages.content` holds ciphertext envelopes.
- Voice tokens: `call-service` mints a LiveKit token for a channel member,
  refuses a non-member with 404, and the LiveKit signal socket accepts that
  token over `ws://127.0.0.1:7880`.
- **Two clients in one voice channel**: both participants reach `participant
  active` in LiveKit over UDP and publish `audio/opus` with `encryption: 1`,
  which is the end-to-end encrypted path - the SFU forwards frames it cannot
  decode. One client sees the other's `trackPublished`.
- presence-service: both clients connect to `/ws/presence`, appear in the Redis
  online set, and the voice roster in Redis lists both members of the channel.
  A scripted client reproduces `presence.sync` and `voice.changed`.
- The member list showed "2 online" with green dots in the running app, and the
  voice roster under the channel named the connected member.
- Voice roster join/leave verified with a scripted presence client: listed after
  `voice.join`, gone after `voice.leave`.

Not yet exercised:

- Audio actually heard by a human on each end, camera, and screen share.
- Typing indicators observed in the UI (the events are wired and the server
  publishes them, but nobody has watched one land).

### Fixed: publishing failed against an outdated SFU

Joining reported *"the microphone did not start (negotiation timed out)"* while
the connection itself was up, and the mic, camera and screen-share buttons all
failed the same way afterwards. LiveKit's debug log named it:

```
Initial connection failed: v1 RTC path not found.
Consider upgrading your LiveKit server version - Retrying
negotiation due to track publish failed, retrying after reconnect
```

The root cause is a protocol gap, not ICE or a permission. `livekit-client`
tags every publisher offer with an incrementing `SessionDescription.id` and
resolves the publish only when an answer echoes an id past that checkpoint.
`livekit/livekit-server:v1.7` predates that field, so its answers came back
with id `0`, the client's `OfferAnswered` check never passed, and every publish
- microphone, camera, screen share - rejected on the 15s deadline even though
the SDP answer had been applied. Media was never the problem, which is why the
room still connected and the roster still populated.

Fixed by moving both compose files to `livekit/livekit-server:v1.13.5`. The
image tag must now be kept in step with the `livekit-client` version in
`apps/desktop`.

Two other causes were ruled out along the way and are fixed: a hot reload used
to leave an orphaned Room connected under the same identity, which LiveKit
answers by kicking the older session (`DUPLICATE_IDENTITY`), and clicking an
already-joined channel did the same thing.
- Redis Pub/Sub fanout across two instances of the same service.
- Container builds from the service Dockerfiles and the Nginx gateway path
  (services are hit directly on their ports in development).

Phase 10 turns the smoke script into automated tests in CI and clears the rest.

## Companion documents

- `MVP.md` — what the first runnable version covers
- `E2EE.md` — encryption design, threat model and its known limits
- `TESTING.md` — running two clients locally (`pnpm dev:duo`)
- `TODO.md` — ordered backlog

## Conventions

- TypeScript strict everywhere. No `any` in committed code.
- Controllers thin, services hold logic, Prisma access stays in services.
- Every service exposes `GET /health`.
- API errors use the shape in `CLAUDE.md` §24 (`code`, `message`, `requestId`).
- Commits: conventional commits (`feat:`, `fix:`, `chore:`, `docs:`).
