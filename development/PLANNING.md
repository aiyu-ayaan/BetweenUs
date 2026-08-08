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
| 8 | Hardening | Tests, CI, error contract polish, request IDs everywhere | Next |
| 9 | Presence | Presence service, online status, typing indicators | Planned |
| 10 | Calls | LiveKit + call-service tokens, voice/video/screen share | Planned |
| 11 | Remote desktop | remote-gateway, remote-agent, remote permissions, audit log | Planned |
| 12 | Production ingress | Cloudflare Tunnel, TLS, secret management, deploy pipeline | Planned |

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
- **Media never passes through NestJS.** Nothing in the MVP touches media, so
  this stays true by construction.

## Running the stack

```bash
cp .env.example .env
docker compose -f infrastructure/docker/docker-compose.dev.yml up -d
pnpm install
pnpm db:generate && pnpm db:migrate
pnpm dev
```

Desktop app: `pnpm --filter @nexora/desktop dev`.

## Verification status (as of phase 7)

What has been proven on the development machine:

- `pnpm build` and `pnpm typecheck` pass across all 22 workspace tasks.
- `pnpm check` self-checks pass for logger (redaction), auth (token/password
  round-trips, cross-token rejection) and websocket (room bookkeeping,
  handshake token parsing).
- `auth-service` boots, serves `/health` (`degraded` with no database, as
  designed) and returns the documented error shape with a request id on invalid
  input.

- The initial Prisma migration (`20260808091410_init`) applies to a real
  Postgres and the seed runs.
- `apps/services/chat-service/smoke.mjs` passes against the three services:
  register → `/me` → refresh (and rejection of the rotated token) → workspace →
  channels → WebSocket subscribe → REST send → realtime receive → history →
  anonymous socket closed with 4401 → upload → download → traversal blocked.

Not yet exercised:

- Redis Pub/Sub fanout across two chat-service instances
- Container builds from the service Dockerfiles and the Nginx gateway path
  (services were hit directly on their ports)

Phase 8 turns the smoke script into automated tests in CI.

## Conventions

- TypeScript strict everywhere. No `any` in committed code.
- Controllers thin, services hold logic, Prisma access stays in services.
- Every service exposes `GET /health`.
- API errors use the shape in `CLAUDE.md` §24 (`code`, `message`, `requestId`).
- Commits: conventional commits (`feat:`, `fix:`, `chore:`, `docs:`).
