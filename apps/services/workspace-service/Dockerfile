# Build from the repo root: docker build -f apps/services/workspace-service/Dockerfile .
FROM node:20-alpine AS base
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml turbo.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/services/workspace-service ./apps/services/workspace-service
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @nexora/workspace-service... build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /repo /repo
WORKDIR /repo/apps/services/workspace-service
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
