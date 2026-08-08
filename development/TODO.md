# Nexora TODO

Ordered backlog. Check items off as they land; keep the "Next up" section at
the top honest — it is what a new session reads first.

## Next up (phase 8: hardening)

- [ ] Promote `apps/services/chat-service/smoke.mjs` into CI as an integration
      test (it already passes locally against Postgres + Redis)
- [ ] Verify the Nginx gateway path and container builds end to end
- [ ] Unit tests for `AuthService` (register/login/refresh) with a Prisma mock
- [ ] Integration test: register → create workspace → create channel → send message
- [ ] GitHub Actions workflow: install → lint → typecheck → build
- [ ] Request-ID middleware wired into the logger context in every service
- [ ] Refresh-token reuse detection (revoke whole token family on replay)
- [ ] Rate limit login/register at the service level, not only in Nginx

## Done

### Phase 1 — dev infrastructure
- [x] `docker-compose.dev.yml` with Postgres + Redis only, bound to localhost
- [x] `.env.example` covering every variable the MVP reads

### Phase 2 — shared packages
- [x] `@nexora/shared-types` — DTOs, API contracts, WebSocket event types
- [x] `@nexora/config` — typed env loading
- [x] `@nexora/logger` — structured JSON logger with redaction
- [x] `@nexora/auth` — JWT sign/verify, Nest `JwtAuthGuard`, `@CurrentUser()`
- [x] `@nexora/permissions` — role and permission constants
- [x] `@nexora/events` — event names and payload contracts, Redis publisher
- [x] `@nexora/database` — Prisma schema + client singleton

### Phase 3 — auth service
- [x] `POST /api/v1/auth/register`
- [x] `POST /api/v1/auth/login`
- [x] `POST /api/v1/auth/refresh` with rotation
- [x] `POST /api/v1/auth/logout`
- [x] `GET /api/v1/auth/me`
- [x] `GET /health`

### Phase 4 — workspace service
- [x] Create / list workspaces, owner membership on create
- [x] Create / list channels, membership-checked
- [x] `GET /health`

### Phase 5 — chat service
- [x] `GET /api/v1/messages?channelId=&before=` history paging
- [x] `POST /api/v1/messages` send
- [x] `/ws/chat` WebSocket gateway with JWT handshake auth
- [x] Redis Pub/Sub fanout so multiple instances stay in sync
- [x] `GET /health`

### Storage
- [x] `@nexora/storage` with local-disk and S3 drivers, chosen from env
- [x] `POST /api/v1/uploads` and `GET /api/v1/uploads/:key` in chat-service
- [x] Key generation, traversal guard, content-type allowlist, inline/attachment
      disposition rules
- [ ] Attachment model on `Message` so uploads attach to a message
- [ ] Avatar upload wired to the user profile
- [ ] Orphan sweep for uploaded objects never referenced by a message

### Phase 6 — gateway
- [x] Nginx REST + WebSocket routing, rate limiting, body size limits
- [x] Production `docker-compose.yml` with per-network isolation

### Phase 7 — desktop client
- [x] Electron main + hardened preload (contextIsolation, no nodeIntegration)
- [x] Vite + React + Tailwind + Zustand renderer
- [x] Login / register screen
- [x] Workspace + channel sidebar, create dialogs
- [x] Message list with realtime WebSocket updates

## Backlog (later phases)

### Phase 9 — presence
- [ ] `presence-service` with Redis-backed online/idle/offline state
- [ ] `/ws/presence` gateway, heartbeat, typing indicators
- [ ] Desktop presence dots in member list

### Phase 10 — calls
- [ ] `call-service`: LiveKit room lifecycle + access-token minting
- [ ] LiveKit container in compose, `livekit.yaml` config
- [ ] Desktop voice/video UI, screen-share picker via Electron `desktopCapturer`

### Phase 11 — remote desktop
- [ ] `remote-agent`: device identity, outbound WebSocket, screen capture, input
- [ ] `remote-gateway`: session relay, authorization, audit log
- [ ] Remote permission model (`REMOTE_VIEW`, `REMOTE_CONTROL`, …) with expiry
- [ ] Desktop remote client view

### Phase 12 — production
- [ ] Cloudflare Tunnel config + `cloudflared` container wired to Nginx
- [ ] Secret management, no secrets in compose files
- [ ] Docker image build + push pipeline, health-checked deploys

### Cross-cutting debt
- [ ] Split the shared Prisma schema into per-service schemas
- [ ] Replace Redis Pub/Sub with NATS when fanout volume needs it
- [ ] Full RBAC permission checks (currently membership + coarse role only)
- [ ] `user-service` (profiles, avatars, friends) and `notification-service`
