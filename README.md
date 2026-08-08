# Nexora

Discord-like communication platform with secure remote desktop access, built as
a pnpm + Turborepo monorepo. `CLAUDE.md` holds the target architecture;
`development/` tracks what is built and what comes next.

## Status

Working end to end: register / login, servers with per-member permissions,
public and private text channels with end-to-end encrypted messages and
realtime delivery, direct messages between friends, Discord-style voice
channels over LiveKit with end-to-end encrypted media, screen share, presence
with a choosable status and typing indicators - in an Electron desktop client.

Not built yet: remote desktop, notifications, user profiles. See
`development/PLANNING.md`, `development/E2EE.md` and `development/TODO.md`.

## Requirements

- Node.js 20+
- pnpm 9
- Docker Desktop (only to run Postgres, Redis and LiveKit locally)

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
pnpm dev:duo                                           # two signed-in test windows
```

`pnpm dev:infra` / `pnpm dev:infra:down` are shortcuts for the compose commands.
Only Postgres and Redis run in Docker for development - no local database
install needed, and services run on the host for fast reloads.

Default ports: gateway `8080`, auth `3001`, server `3003`, chat `3004`,
presence `3005`, call `3007`, LiveKit `7880`, desktop renderer `5173`.

`pnpm dev:duo` opens two Electron windows signed in as different users, each
with its own profile and encryption key, which is the only sane way to test
chat, voice and presence. See `development/TESTING.md`.

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
apps/services/*           NestJS microservices (auth, server, chat, call,
                          presence built)
packages/*                shared-types, auth, permissions, database, events,
                          websocket, storage, logger, config, nest-common
infrastructure/           docker compose, nginx, cloudflare, livekit
development/              planning, MVP definition, E2EE design, testing, TODO
```

## Common commands

| Command | Effect |
| --- | --- |
| `pnpm build` | Build every package, service and the desktop bundle |
| `pnpm typecheck` | Type-check the whole monorepo |
| `pnpm check` | Run package self-checks (logger, auth, websocket, storage, desktop crypto) |
| `pnpm dev:desktop` | Run only the desktop client |
| `pnpm dev:duo` | Two signed-in desktop windows for chat/voice testing |
| `pnpm db:studio` | Open Prisma Studio against the dev database |
| `pnpm --filter @nexora/chat-service smoke` | End-to-end check against running services |

## API surface

```
POST /api/v1/auth/register|login|refresh|logout    GET /api/v1/auth/me
GET|POST /api/v1/servers         POST /api/v1/servers/join
GET|PATCH|DELETE /api/v1/servers/:id      POST /api/v1/servers/:id/leave
GET /api/v1/servers/:id/members  PATCH|DELETE /api/v1/servers/:id/members/:userId
GET|POST /api/v1/channels        PATCH|DELETE /api/v1/channels/:id
GET|PUT /api/v1/channels/:id/members      GET|POST /api/v1/messages
GET /api/v1/users/search         GET|POST /api/v1/friends
POST /api/v1/friends/:id/accept  DELETE /api/v1/friends/:id
GET|POST /api/v1/dm
POST /api/v1/uploads             GET /api/v1/uploads/:key
GET|POST /api/v1/e2ee/devices    GET /api/v1/e2ee/keys/:channelId
POST /api/v1/e2ee/keys           POST /api/v1/calls/token
WS   /ws/chat                    WS  /ws/presence
GET  /health (every service)
```
