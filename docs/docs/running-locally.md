---
sidebar_position: 8
---

# Running Locally

## Prerequisites

- Node.js 20+, pnpm 9 (`packageManager` field pins it — `corepack enable`
  picks it up automatically)
- Docker (for Postgres + Redis, and for a full container run)

## The backend, in a few commands

```bash
git clone https://github.com/aiyu-ayaan/Nexora.git betweenus
cd betweenus
cp .env.example .env

pnpm install
pnpm dev:infra              # Postgres + Redis via Docker Compose
pnpm db:generate
pnpm db:migrate
pnpm dev:backend             # every service, watch mode
```

`pnpm dev:infra` reads `.env` from `infrastructure/docker/`, not the repo
root — the script passes `--env-file .env` for you; running `docker compose`
by hand without that flag starts every service with empty `${VAR}`s.

`pnpm dev:backend` runs the services only. `pnpm dev` additionally starts
the desktop renderer on port 5173, which collides with `pnpm dev:duo` (see
[Testing](/testing)) — use `dev:backend` when you plan to run `dev:duo`
alongside it.

## Desktop client

```bash
pnpm --filter @betweenus/desktop dev
```

## Web client

```bash
pnpm dev:web
```

Serves at [http://localhost:5175](http://localhost:5175). The dev server proxies the same routes
the desktop client talks to, minus `/api/v1/remote` and `/ws/remote` — the
browser build has no remote-desktop section.

## Admin panel

```bash
pnpm dev:admin
```

The first administrator is created from the CLI, not a web form — a page
open to the internet that could mint the first admin is a race anyone could
win:

```bash
pnpm admin:create
```

## Two signed-in windows (chat, voice, presence)

```bash
pnpm dev:duo
```

See [Testing](/testing) for what it sets up and what to try.

## Full container stack

```bash
cp .env.example .env
pnpm prod:build
pnpm prod:up          # pull published images, or:
pnpm prod:up:build    # build images locally
```

See [Docker Compose](/deployment/docker-compose) for the service list and
networks.

## Database

```bash
pnpm db:generate    # Prisma client
pnpm db:migrate      # apply migrations (dev)
pnpm db:seed          # seed data
pnpm db:studio          # Prisma Studio, browse the data
```

## Android

```bash
cd apps/android
./gradlew assembleDebug
```

Needs JDK 21. `local.properties` sets `betweenus.serverUrl`, which is only
a default — the login screen's server picker overrides it at runtime.

## Docs site

```bash
cd docs
npm install
npm start        # http://localhost:3000, live reload
npm run build     # static site into docs/build/
npm run serve      # serve the production build locally
```

See [Docs Deployment](/deployment/docs-deployment) for how a `!docs` commit
publishes this to GitHub Pages.
