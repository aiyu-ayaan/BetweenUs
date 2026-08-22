---
sidebar_position: 9
---

# Testing

Full source: [`development/TESTING.md`](https://github.com/aiyu-ayaan/BetweenUs/blob/master/development/TESTING.md).

## Package self-checks

`pnpm check` (or `pnpm -r check`) runs assert-based checks inside the
packages where correctness matters most: `@betweenus/auth` (tokens,
secrets, algorithm pinning), `@betweenus/nest-common` (client address
resolution, rate buckets), `@betweenus/permissions` (role/grant
resolution), `@betweenus/storage` (keys, allowlists, inline safety), and
`auth-service` (login, rotation, reuse detection, OAuth redirects) — each
against an in-memory database, no external services required.

## Integration smoke scripts

Real REST + WebSocket traffic against a running stack, not mocks:

```bash
node apps/services/chat-service/smoke.mjs
node apps/services/presence-service/smoke.mjs
node apps/services/notification-service/smoke.mjs
node apps/services/remote-gateway/smoke.mjs
```

These are what CI's `integration` job runs against Postgres/Redis service
containers — see [CI](/deployment/ci).

## Two accounts, signed in, for manual testing

Most things worth testing need a second participant — a message has a
receiver, a call has another peer, and E2EE only means something when a key
was actually exchanged between two devices.

```bash
pnpm dev:infra          # Postgres and Redis
pnpm db:migrate         # first run only
pnpm dev:backend        # backend services (leave running)
pnpm dev:duo            # in a second terminal
```

Opens two Electron windows, each already signed in and sharing a **Duo
Test** server:

| Window | Account | Role |
| --- | --- | --- |
| Alice | `alice@betweenus.local` | server owner |
| Bob | `bob@betweenus.local` | member |

Password for both: `betweenus-dev-1`. Alice owns `#owners-only`, a private
channel Bob is deliberately not on; the two start as friends with a DM
already open. Each window runs with its own Electron profile
(`BETWEENUS_PROFILE=duo-a`/`duo-b`) — its own session, `localStorage`, and
E2EE device key, because sharing a profile would defeat the point.

Re-running `pnpm dev:duo` is harmless — it signs in rather than
re-registering if the accounts already exist.

### What to check by hand

- **Chat**: a message typed in Alice's window appears in Bob's; the row in
  Postgres is ciphertext (`pnpm db:studio`).
- **Attachments**: drag a photo onto the composer — the object on disk in
  `storage-data` is not a viewable image, which is the point. A file over 8
  MB uploads in visible parts (multipart).
- **Voice/video**: join the **lounge** voice channel from both windows.
- **Remote desktop**: enroll a machine from Settings → Remote Access, grant
  a permission, request a session from the other window.
