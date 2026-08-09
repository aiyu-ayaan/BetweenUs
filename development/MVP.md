# Nexora MVP

Scope definition for the first runnable version. Everything outside "In scope"
is deliberately deferred — see `TODO.md` for the ordered backlog.

## Goal

A developer clones the repo, starts Postgres + Redis with one Docker command,
runs `pnpm dev`, and can: register, log in, create a server, create a text
channel, and exchange messages in realtime between two desktop clients.

## In scope

| Area | Included |
| --- | --- |
| Auth | Register, login, refresh-token rotation, `/me`, JWT access tokens |
| Servers | Create server, list own servers, membership with role |
| Channels | Create text channel in a server, list channels |
| Messages | Send, list history (paged), realtime delivery over WebSocket (deletion landed in phase 15) |
| Desktop | Electron + React + Tailwind + Zustand: login, server/channel sidebar, message view |
| Gateway | Nginx routing REST + WebSocket to services |
| Data | PostgreSQL via Prisma, Redis Pub/Sub for cross-instance message fanout |
| Uploads | File upload/download with local-disk storage by default, S3 when configured (encrypted attachments and profile pictures landed in phase 13) |
| Dev infra | `docker-compose.dev.yml` with Postgres + Redis only |

The MVP is done. Encrypted messaging and calls landed in phase 8 on top of it —
see `PLANNING.md` and `E2EE.md`; the list below is the scope line as it stood
when the MVP shipped.

## Out of scope for MVP (shipped in phase 8)

- Voice / video / screen share (LiveKit, `call-service`)
- End-to-end encryption of messages and call media

## Out of scope for MVP (still ahead)

- Remote desktop (`remote-gateway`, `remote-agent`, remote permissions)
- Presence service, typing indicators
- Push notifications to a signed-out or sleeping client (the desktop client
  raises local notifications since phase 11, and `notification-service` holds
  the mutes, quiet hours and read state since phase 14)
- User service (profiles, avatars, friends); message-attachment linking
- ~~OAuth logins~~ (shipped in phase 11: Google and GitHub, configured from the
  admin panel), email verification, password reset
- Replies (~~direct messages~~ shipped in phase 12; ~~message deletion~~,
  ~~editing~~, ~~reactions~~, pins and in-client search in phase 15)
- Full RBAC permission matrix (MVP has coarse roles: OWNER / MEMBER)
- Cloudflare Tunnel production ingress, CI/CD pipeline, Kubernetes

## Services running in MVP

```
Desktop (Electron)
      |
      v
Nginx  :8080
      |-- /api/v1/auth        -> auth-service       :3001
      |-- /api/v1/servers  -> server-service  :3003
      |-- /api/v1/channels    -> server-service  :3003
      |-- /api/v1/messages    -> chat-service       :3004
      `-- /ws/chat            -> chat-service       :3004 (WebSocket)

Postgres :5432        Redis :6379
```

Scaffolded but intentionally empty: `user-service`, `remote-gateway`,
`remote-agent`. Built since the MVP: `presence-service`, `call-service`,
`notification-service`.

## Known MVP shortcuts

These are conscious trade-offs, each with an upgrade path:

1. **Single Prisma schema shared by services.** The target architecture gives
   each service its own data. Upgrade path: split the schema per service and
   move cross-service reads behind REST/events. Tracked in `TODO.md`.
2. **Coarse roles only.** `OWNER` / `MEMBER`, no granular permission checks
   beyond membership. Upgrade path: `packages/permissions` already defines the
   full permission constants; add role→permission mapping and a guard.
3. **Redis Pub/Sub, not NATS.** As the architecture doc prescribes for stage 1.
4. ~~**No refresh-token family revocation on reuse detection.**~~ Closed in
   phase 10: replaying a spent token revokes every live token for the account.
