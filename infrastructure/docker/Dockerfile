# syntax=docker/dockerfile:1.7-labs
#
# One Dockerfile for every server image. Build from the repo root and pick the
# service with a target:
#
#   docker build -f infrastructure/docker/Dockerfile --target chat-service .
#
# Why one file rather than one per service: the eight images used to repeat the
# same `pnpm install` and the same TypeScript build, so a full `up -d --build`
# paid for the workspace eight times over. Sharing the stages means BuildKit
# installs once, compiles once, and the seven Node images end up sharing one
# identical filesystem layer instead of eight near-identical ones.
#
# The `syntax` line above pulls the BuildKit frontend that provides
# `COPY --parents`; it is what lets the dependency stage take the workspace
# manifests without dragging the source in behind them.

FROM node:20-alpine AS base
# Prisma's query engine links against OpenSSL, which the alpine image omits.
RUN apk add --no-cache openssl && corepack enable
WORKDIR /repo

# ---------------------------------------------------------------------------
# Dependencies. Only manifests land here, so editing a line of TypeScript no
# longer invalidates the install - by far the slowest step in the build.
# ---------------------------------------------------------------------------
FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY --parents packages/*/package.json apps/admin/package.json apps/web/package.json apps/services/*/package.json ./
# @betweenus/database runs `prisma generate` on postinstall, which needs the schema.
COPY packages/database/prisma ./packages/database/prisma
# The root package's postinstall hook. It is a no-op here - it configures the
# Electron binary for apps/desktop, which no image installs - but pnpm still
# runs it, and a missing file is MODULE_NOT_FOUND and a failed install.
COPY scripts/ensure-electron.mjs ./scripts/ensure-electron.mjs
# The store survives between builds, so a lockfile change re-links rather than
# re-downloads. apps/desktop's *manifest* is deliberately absent - its Electron
# binary would dominate the install, and nothing here packages the desktop app.
# Its source still arrives in the build stage below, because the web client
# mounts it.
RUN --mount=type=cache,id=betweenus-pnpm-store,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store && \
    pnpm install --frozen-lockfile

# ---------------------------------------------------------------------------
# Compile. One `pnpm build` for the whole workspace: cheaper than eight
# per-service builds that each recompile the shared packages.
# ---------------------------------------------------------------------------
FROM deps AS build
COPY turbo.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/admin ./apps/admin
COPY apps/web ./apps/web
COPY apps/services ./apps/services
# The web client is a browser entry point around the UI in apps/desktop/src, so
# that source has to be here - but only that source. Without the manifest the
# workspace does not treat apps/desktop as a package, which is the point: no
# Electron install, and turbo has nothing there to try to build.
COPY apps/desktop/src ./apps/desktop/src
COPY apps/desktop/public ./apps/desktop/public
COPY apps/desktop/tailwind.theme.mjs ./apps/desktop/tailwind.theme.mjs
# Having no manifest has a price: nothing installed anything for this directory,
# so `react` and `zustand` resolve to nothing from inside it
# and the web build stops on a screen of TS2307 before it reaches anything real.
# It compiles as part of @betweenus/web, which declares that exact set - the same
# set, because it is the same UI - so lending it those is both correct and free.
RUN ln -s ../web/node_modules apps/desktop/node_modules
# Turbo skips any package whose inputs are unchanged since the last build.
RUN --mount=type=cache,id=betweenus-turbo,target=/repo/.turbo \
    pnpm build

# ---------------------------------------------------------------------------
# Production dependencies. The same manifests as `deps`, installed again with
# --prod, and nothing else: this stage never sees a line of source.
#
# The runtime used to be a copy of the `build` stage, which meant every service
# image carried the whole workspace install - two copies of TypeScript, the
# turbo binary, esbuild, webpack, the Nest CLI, tsx. 465MB of node_modules to
# run `node dist/main.js`, and none of it reachable from it.
#
# It costs one extra install, which is cached and shares the pnpm store with
# the one above, and it is why `prisma` is a dependency of @betweenus/database
# rather than a devDependency: the `migrate` service in docker-compose.yml runs
# `prisma migrate deploy` out of this image, so the CLI has to survive --prod.
# ---------------------------------------------------------------------------
FROM base AS prod-deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY --parents packages/*/package.json apps/admin/package.json apps/web/package.json apps/services/*/package.json ./
COPY packages/database/prisma ./packages/database/prisma
COPY scripts/ensure-electron.mjs ./scripts/ensure-electron.mjs
RUN --mount=type=cache,id=betweenus-pnpm-store,target=/pnpm/store     pnpm config set store-dir /pnpm/store &&     pnpm install --frozen-lockfile --prod

# ---------------------------------------------------------------------------
# Runtime. Every Node service is the same image with a different working
# directory, so the expensive copy happens once and all seven reference it.
#
# Two copies, not one: the production install, then the compiled output laid
# over it. The `/./` in each source path is where the copied tree starts, so
# packages/chat/dist lands at /repo/packages/chat/dist rather than one level
# deeper. Source, tests and the vite output for the two nginx images stay out.
# ---------------------------------------------------------------------------
FROM base AS service
ENV NODE_ENV=production
COPY --from=prod-deps /repo /repo
COPY --from=build --parents /repo/./packages/*/dist /repo/./apps/services/*/dist /repo/
# Where chat-service's upload volume mounts (LOCAL_STORAGE_PATH). It has to
# exist in the image, owned by the user the service runs as: Docker seeds an
# empty named volume from the image path including its ownership, but a
# mountpoint it has to invent for itself arrives root-owned - and then every
# attachment fails with EACCES while everything else about the service works,
# which is a confusing way to find out that file sharing is off.
RUN mkdir -p /data/uploads && chown node:node /data/uploads
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]

FROM service AS auth-service
WORKDIR /repo/apps/services/auth-service

FROM service AS server-service
WORKDIR /repo/apps/services/server-service

FROM service AS chat-service
WORKDIR /repo/apps/services/chat-service

FROM service AS presence-service
WORKDIR /repo/apps/services/presence-service

FROM service AS notification-service
WORKDIR /repo/apps/services/notification-service

FROM service AS call-service
WORKDIR /repo/apps/services/call-service

FROM service AS remote-gateway
WORKDIR /repo/apps/services/remote-gateway

# Static files only: the panel talks to the gateway, which sits in front of it.
FROM nginx:1.27-alpine AS admin-web
COPY --from=build /repo/apps/admin/dist /usr/share/nginx/html/admin
COPY apps/admin/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80

# The web client, same arrangement, served at the root of the gateway.
FROM nginx:1.27-alpine AS web
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
