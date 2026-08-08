# Build from the repo root: docker build -f apps/admin/Dockerfile .
FROM node:20-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml turbo.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/admin ./apps/admin
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @nexora/admin... build

# Static files only: the panel talks to the gateway, which sits in front of it.
FROM nginx:1.27-alpine AS runtime
COPY --from=build /repo/apps/admin/dist /usr/share/nginx/html/admin
COPY apps/admin/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
