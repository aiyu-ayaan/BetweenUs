# Nexora

Discord-like communication platform with secure remote desktop access, built as
a pnpm + Turborepo monorepo. `CLAUDE.md` holds the target architecture;
`development/` tracks what is built and what comes next.

## MVP status

Working end to end: register / login, workspaces, text channels, message history
and realtime delivery, in an Electron desktop client.

Not built yet: voice/video (LiveKit), remote desktop, presence, notifications,
user profiles. See `development/MVP.md` and `development/TODO.md`.

## Requirements

- Node.js 20+
- pnpm 9
- Docker Desktop (only to run Postgres and Redis locally)

## Quick start

```bash
cp .env.example .env                                   # then set JWT secrets
docker compose -f infrastructure/docker/docker-compose.dev.yml up -d
pnpm install
pnpm db:generate
pnpm db:migrate                                        # creates the schema
                                                       # (prompts for a name on
                                                       #  a new migration)
pnpm db:seed                                           # optional: demo@nexora.local / nexora123
pnpm dev                                               # all services + desktop
```

`pnpm dev:infra` / `pnpm dev:infra:down` are shortcuts for the compose commands.
Only Postgres and Redis run in Docker for development - no local database
install needed, and services run on the host for fast reloads.

Default ports: gateway `8080`, auth `3001`, workspace `3003`, chat `3004`,
desktop renderer `5173`.

To run everything in containers instead:

```bash
docker compose -f infrastructure/docker/docker-compose.yml up -d --build
```

## File storage

Uploads go through `@nexora/storage`, which picks its driver from the
environment:

- **S3 variables empty (default):** files are written to `LOCAL_STORAGE_PATH`
  (`./storage-data`) and served by chat-service at `/api/v1/uploads/<key>`. No
  MinIO, no AWS account, nothing to configure.
- **`S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY` and `S3_SECRET_KEY` all set:**
  the S3 driver takes over and returns bucket URLs. Partially filled config
  stays on local disk rather than half-working.
- `STORAGE_DRIVER=local|s3` forces a driver. Forcing `s3` without credentials
  fails at boot instead of silently falling back.

```
POST /api/v1/uploads      multipart field "file", auth required
GET  /api/v1/uploads/:key
```

Keys are UUID-based, so a client filename never decides where a file lands.
Content types are allowlisted, and anything not provably safe to render inline
(SVG, PDF, text) is served with `Content-Disposition: attachment`.

## Repository layout

```
apps/desktop              Electron + React + Tailwind + Zustand client
apps/services/*           NestJS microservices (auth, workspace, chat built)
packages/*                shared-types, auth, permissions, database, events,
                          websocket, storage, logger, config, nest-common
infrastructure/           docker compose, nginx, cloudflare, livekit
development/              planning, MVP definition, TODO backlog
```

## Common commands

| Command | Effect |
| --- | --- |
| `pnpm build` | Build every package, service and the desktop bundle |
| `pnpm typecheck` | Type-check the whole workspace |
| `pnpm check` | Run package self-checks (logger, auth, websocket, storage) |
| `pnpm dev:desktop` | Run only the desktop client |
| `pnpm db:studio` | Open Prisma Studio against the dev database |
| `pnpm --filter @nexora/chat-service smoke` | End-to-end check against running services |

## API surface (MVP)

```
POST /api/v1/auth/register|login|refresh|logout    GET /api/v1/auth/me
GET|POST /api/v1/workspaces      POST /api/v1/workspaces/join
GET /api/v1/workspaces/:id/members|channels
GET|POST /api/v1/channels        GET|POST /api/v1/messages
POST /api/v1/uploads             GET /api/v1/uploads/:key
WS   /ws/chat
GET  /health (every service)
```
