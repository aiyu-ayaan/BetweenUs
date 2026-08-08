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
- presence-service accepts both clients on `/ws/presence`.

Not yet exercised:

- Two people actually hearing each other in a voice channel: media flow,
  E2EE frames, screen share (needs a human on each end).
- Typing indicators and online dots observed in the UI (the sockets connect and
  the events are wired, but nobody has watched them land).
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
