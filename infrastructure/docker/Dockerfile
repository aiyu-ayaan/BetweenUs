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
COPY --parents packages/*/package.json apps/admin/package.json apps/services/*/package.json ./
# @nexora/database runs `prisma generate` on postinstall, which needs the schema.
COPY packages/database/prisma ./packages/database/prisma
# The store survives between builds, so a lockfile change re-links rather than
# re-downloads. apps/desktop is deliberately absent: no image builds it, and its
# Electron binary would dominate the install.
RUN --mount=type=cache,id=nexora-pnpm-store,target=/pnpm/store \
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
COPY apps/services ./apps/services
# Turbo skips any package whose inputs are unchanged since the last build.
RUN --mount=type=cache,id=nexora-turbo,target=/repo/.turbo \
    pnpm build

# ---------------------------------------------------------------------------
# Runtime. Every Node service is the same image with a different working
# directory, so the expensive copy happens once and all seven reference it.
# ---------------------------------------------------------------------------
FROM base AS service
ENV NODE_ENV=production
COPY --from=build /repo /repo
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
