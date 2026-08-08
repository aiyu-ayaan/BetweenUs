# Build from the repo root: docker build -f apps/services/chat-service/Dockerfile .
FROM node:20-alpine AS base
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml turbo.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/services/chat-service ./apps/services/chat-service
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @nexora/chat-service... build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /repo /repo
WORKDIR /repo/apps/services/chat-service
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
