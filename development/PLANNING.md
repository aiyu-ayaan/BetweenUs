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
| 8 | Encrypted chat + calls | E2EE messages, call-service + LiveKit, two-window dev harness | Done |
| 9 | Hardening | Tests, CI, error contract polish, request IDs everywhere | Next |
| 10 | Presence | Presence service, online status, typing indicators | Planned |
| 11 | Remote desktop | remote-gateway, remote-agent, remote permissions, audit log | Planned |
| 12 | Production ingress | Cloudflare Tunnel, TLS, secret management, deploy pipeline | Planned |

Phase 8 swapped places with hardening: encryption changes the message format, so
it was cheaper to land before tests were written against the old one.

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
- **One channel key, shared by chat and calls.** A member who can read a channel
  can join its call, so a second key exchange for media would add code and no
  security. Design and limits: `E2EE.md`.
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

Two signed-in windows for testing chat and calls: `pnpm dev:duo` — see
`TESTING.md`.

## Verification status (as of phase 8)

What has been proven on the development machine:

- `pnpm build`, `pnpm typecheck` and `pnpm check` pass across all workspace
  tasks, including the new `call-service` and the desktop crypto self-check.
- `pnpm --filter @nexora/desktop check` proves the E2EE primitives: wrap/unwrap
  between two identities, rejection of a third party's private key, message
  round-trip, wrong-key and tampered-ciphertext rejection, and that plaintext
  never survives serialisation.
- `pnpm check` self-checks pass for logger (redaction), auth (token/password
  round-trips, cross-token rejection), storage and websocket.
- `auth-service` boots, serves `/health` (`degraded` with no database, as
  designed) and returns the documented error shape with a request id on invalid
  input.
- The initial Prisma migration (`20260808091410_init`) applies to a real
  Postgres and the seed runs.
- As of phase 7, `apps/services/chat-service/smoke.mjs` passed against the three
  services: register → `/me` → refresh (and rejection of the rotated token) →
  workspace → channels → WebSocket subscribe → REST send → realtime receive →
  history → anonymous socket closed with 4401 → upload → download → traversal
  blocked.

Not yet exercised — the machine this phase was written on has no Docker, so
nothing that needs Postgres, Redis or LiveKit could be run:

- The `20260808150000_e2ee_keys` migration. It was generated with
  `prisma migrate diff` and has not been applied to a real database.
- The E2EE section added to `smoke.mjs` (device directory, key publish/fetch,
  epoch ordering).
- Two clients exchanging an encrypted message end to end, and `pnpm dev:duo`
  itself.
- A LiveKit call: token minting, joining, E2EE media, screen share.
- Redis Pub/Sub fanout across two chat-service instances.
- Container builds from the service Dockerfiles and the Nginx gateway path.

Phase 9 turns the smoke script into automated tests in CI and clears this list.

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
