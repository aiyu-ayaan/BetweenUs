# Build from the repo root: docker build -f apps/services/call-service/Dockerfile .
FROM node:20-alpine AS base
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml turbo.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/services/call-service ./apps/services/call-service
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @nexora/call-service... build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /repo /repo
WORKDIR /repo/apps/services/call-service
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
