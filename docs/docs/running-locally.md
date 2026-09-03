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
git clone https://github.com/aiyu-ayaan/BetweenUs.git betweenus
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
pnpm --filter @betweenus/desktop dev    # run in development
pnpm desktop:package                    # package production executable (.exe / installer)
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
pnpm android:build    # debug APK
pnpm android:test     # unit tests
pnpm android:run      # install it on a connected device and start it
```

Needs a JDK on `PATH` to launch the wrapper, but no particular version of
one: Gradle provisions the daemon JVM itself, pinned to 17 by
`apps/android/gradle/gradle-daemon-jvm.properties`. `android:run` also wants
an Android SDK and `adb` on `PATH`.

`local.properties` sets `betweenus.serverUrl`, which is only a default — the
login screen's server picker overrides it at runtime. The emulator reaches
this machine at `10.0.2.2`, so `http://10.0.2.2:8090` is `pnpm dev:gateway`
seen from inside it.

## Docs site

From the repo root (`docs/` is a standalone npm project, not a pnpm
workspace member, so these wrap `npm --prefix docs`):

```bash
pnpm docs:install
pnpm docs           # http://localhost:3000, live reload
pnpm docs:build      # static site into docs/build/
```

Or directly:

```bash
cd docs
npm install
npm start
npm run build
npm run serve      # serve the production build locally
```

See [Docs Deployment](/deployment/docs-deployment) for how a `!docs` commit
publishes this to GitHub Pages.


## `pnpm db:migrate` can reset your database, and what stops it

`db:migrate` runs `prisma migrate dev`. That command verifies the **whole**
migration history before it applies anything, and the only remedy it offers for
a history it cannot reconcile is to drop the database and replay from empty. On
a developer's machine that prompt arrives at the end of a wall of output and is
easy to answer yes to, because it reads as being about the migration you just
wrote.

The usual way to get there is a **renamed migration directory**. Your database
holds a `_prisma_migrations` row naming a directory that is no longer on disk,
`migrate dev` calls that a diverged history, and offers the reset. It has
happened here once already — see
`packages/database/prisma/reconcile/2026-09-02-rename-custom-roles-and-attachments.sql`.

`pnpm db:migrate` now runs `prisma/preflight.mjs` first, which:

- renames the rows for any directory listed in its `RENAMED` map, so a known
  rename repairs itself and the migration carries on;
- **stops** with a non-zero exit for any other applied-but-missing migration,
  naming it, before `migrate dev` gets the chance to offer a reset.

It only ever updates `_prisma_migrations.migration_name`. It never drops,
truncates or alters anything else.

**If you rename a migration directory, add the old and new names to `RENAMED` in
the same commit.** A rename with no entry there is the bug this exists for.

Two other habits worth having:

```bash
pnpm db:migrate:check   # does the migration history still replay to schema.prisma?
pnpm db:backup          # a dump, before anything that touches the schema
```

`db:migrate:check` catches a hand-written migration that disagrees with
`schema.prisma` — which is the *other* way to arrive at a drift prompt. Neither
of these is run for you by `db:migrate`, and `db:backup` needs Docker.
