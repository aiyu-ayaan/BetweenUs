# Nexora TODO

Ordered backlog. Check items off as they land; keep the "Next up" section at
the top honest — it is what a new session reads first.

## Next up (phase 10: hardening)

- [x] Move `livekit/livekit-server` to v1.13.5 in both compose files. v1.7
      predated `SessionDescription.id`, so the client never saw its publisher
      offer acknowledged and every publish failed with "negotiation timed out".
      Keep the tag in step with `livekit-client` in `apps/desktop`
- [ ] Two humans in a voice channel: audio actually heard, camera, screen share
      (both clients already reach LiveKit and publish encrypted opus)
- [ ] Watch a typing indicator land in the UI
- [ ] Promote `apps/services/chat-service/smoke.mjs` into CI as an integration
      test
- [ ] Presence smoke test: connect two sockets, assert sync/typing/voice events
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

### Phase 8 — encrypted chat and voice
- [x] `@nexora/shared-types` contracts for envelopes, device keys, channel keys
      and call tokens
- [x] `device_keys` + `channel_keys` Prisma models and migration
- [x] `/api/v1/e2ee` in chat-service: device directory, channel-key publish and
      fetch, epoch ordering and holder rules
- [x] Desktop E2EE: ECDH P-256 identity per device, HKDF key wrapping,
      AES-256-GCM messages, self-check covering the primitives
- [x] Private keys sealed with Electron `safeStorage` through IPC
- [x] `call-service`: LiveKit access tokens, membership-checked, `/health`
- [x] LiveKit container, `livekit.yaml`, Nginx routes, compose wiring
- [x] Desktop call UI: participant tiles, mic/camera/screen toggles, E2EE media
      via `ExternalE2EEKeyProvider` (join aborts rather than downgrades)
- [x] Screen-share capture handler in the Electron main process
- [x] `pnpm dev:duo`: two seeded users, two Electron profiles, one dev server
- [x] `development/E2EE.md` and `development/TESTING.md`

Follow-ups this phase deliberately left open:

- [ ] Rotate the channel key (epoch + 1) when a member is removed
- [ ] Multi-device support: key list per user instead of one device key
- [ ] Identity verification UI (safety numbers) so a lying server is detectable
- [ ] Encrypt attachments with the channel key too
- [x] Screen-share source picker instead of always taking the primary screen:
      screens and windows with thumbnails, plus a system-audio option on Windows
- [ ] Secure context for packaged builds, so E2EE media works outside dev

### Phase 9 — presence and voice channels
- [x] `presence-service` with `/ws/presence`, Redis-backed online set, voice
      rosters and typing fanout over Redis Pub/Sub
- [x] Online dots in a member list, "is typing" above the composer
- [x] Voice channels Discord-style: `VOICE` channel type in the sidebar, click
      to join, roster visible without joining
- [x] Removed the per-text-channel call button
- [x] Voice panel: participants, mic/camera/screen toggles, disconnect
- [x] Join no longer fails when the machine has no microphone
- [x] Single-flight token refresh (concurrent refreshes were killing sessions)
- [x] `LIVEKIT_URL` on `127.0.0.1`: Chromium tries `::1` first and the container
      publishes IPv4 only
- [x] `dev:duo` seeds a voice channel, skips the login screen, and mirrors
      renderer errors into the terminal
- [x] CSP allows the LiveKit origin - its signal handshake starts with an HTTP
      fetch, which `connect-src` was blocking, plus `worker-src blob:` for the
      encryption worker LiveKit creates
- [x] Leaving a voice channel clears the roster on every path, not only the
      button: a kick, a drop or a crash reports it too, and presence-service
      heals a drifted roster on join and on first connect
- [x] Joining a channel you are already in is a no-op (it used to open a second
      session and get the first kicked for duplicate identity)
- [x] A hot reload hands the Room back before the module is replaced
- [x] Microphone, camera and screen-share failures report their real reason and
      no longer read as a failed join
- [x] LiveKit client debug logging in development, mirrored to the terminal
- [x] Voice channel screen in the main content area: participant tiles with
      camera/screen video, an empty state with a Join Voice button, and controls
      under it. The first click on a voice channel joins, later clicks only
      reopen the screen. Video left the sidebar panel
- [x] A shared screen is its own stage, not a replacement for the sharer's
      camera tile: others get a "NAME is sharing" banner with Join stream, which
      opens a theatre layout - screen large, faces on a strip underneath
- [x] Grid pages at nine tiles with pager arrows, and recent speakers are pulled
      to the front so an active speaker is on page one. Speaking is amber

## Backlog (later phases)

### Presence follow-ups
- [ ] Idle status (currently only online/offline)
- [ ] Scope presence broadcasts to a workspace instead of every connected socket
- [ ] Server-authoritative voice rosters via LiveKit webhooks, so a client that
      lies about joining cannot appear in a channel

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
