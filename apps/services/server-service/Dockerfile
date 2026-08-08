# Build from the repo root: docker build -f apps/services/server-service/Dockerfile .
FROM node:20-alpine AS base
# Prisma's query engine links against OpenSSL, which the alpine image omits.
RUN apk add --no-cache openssl && corepack enable
WORKDIR /repo

FROM base AS build
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml turbo.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/services/server-service ./apps/services/server-service
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @nexora/server-service... build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /repo /repo
WORKDIR /repo/apps/services/server-service
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
