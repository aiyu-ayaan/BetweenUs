---
sidebar_position: 1
---

# Security Overview

Where the API decides who somebody is, what they may reach, and how much of
it they may ask for — condensed from
[`development/SECURITY.md`](https://github.com/aiyu-ayaan/Nexora/blob/master/development/SECURITY.md),
which is the full source and is kept current as the code changes.
[E2EE](/security/e2ee) covers the other half: what the server can't read
even when behaving perfectly.

## Three questions, three places

| Question | Answered by | Where |
| --- | --- | --- |
| Who are you? | `JwtAuthGuard`, `authenticateHandshake` | `packages/auth`, `packages/websocket` |
| May you touch this? | `resolveChannelAccess`, `AdminGuard`, `RemoteService` | `packages/database`, per service |
| How often? | `rateLimit`, Nginx `limit_req` | `packages/nest-common`, `infrastructure/nginx` |

Deliberately three separate places, so forgetting one gate doesn't silently
disable the others. Authorization is **never** read from the JWT — a token
says who you are, not what you may do, because a role can change mid-token.

## Identity

- Access tokens: HS256, 15 minutes, `type: 'access'`. Refresh tokens: a
  different secret, `jti` backed by a database row, `type: 'refresh'`. The
  two secrets are required to differ; the service refuses to start
  otherwise.
- `jwt.verify` pins `algorithms: ['HS256']` explicitly — a token is never
  trusted to name its own algorithm.
- Placeholder secrets (`JWT_SECRET="replace-me"`, shipped in
  `.env.example`) are refused; production requires 32+ characters.
- **Refresh rotation with reuse detection**: presenting an already-spent
  refresh token revokes every live token for the account (a 30-second grace
  window absorbs non-atomic rotation across a flaky network, not theft).
  Tokens are stored as SHA-256 hashes.
- Passwords: bcrypt at 12 rounds, 8+ chars with a letter and a digit. Login
  runs a comparison against a fixed dummy hash even for a missing account,
  so a wrong password and a missing account cost the same time.
- OAuth: the client secret never reaches a client app; the redirect allow
  list is matched as parsed origins, never a string prefix; an account is
  only found by email when the provider says it's verified.

## Authorization

- **Channel access** has one resolver (`resolveChannelAccess`), called by
  chat, call and presence — never three separate copies. A channel the
  caller can't see answers 404, not 403, so ids can't be probed.
- **Permissions**: role defaults + custom roles + grants − denials, deny
  applied last so it always wins.
- **Remote access** is never implied by a server role — every permission is
  granted per user per machine, a session carries the permissions it was
  issued with rather than re-deriving them, and every refusal is audited,
  not just rejected.
- **Attachments** are authorized by the row, not by merely holding a
  session — see [Database Schema](/database/schema#messages--attachments).

## Rate limiting

Two independent layers: Nginx by address at the edge (tight on `/auth` and
`/admin`), and a Redis-backed service-level guard as the backstop for
traffic that reaches a service another way. Login has **two** counters — by
address and by the normalized account being tried — because a botnet spread
over many addresses defeats an address-only budget aimed at one password.

`X-Forwarded-For` is read from the right, not the left (Nginx *appends*, so
the first entry is whatever the caller wrote); `X-Real-IP`, set with
`proxy_set_header` and therefore unspoofable, is preferred.

## Transport and headers

TLS terminates at Cloudflare. The tunnel carries HTTP/WebSocket only — see
[Ingress](/system-design/ingress). The gateway sets
`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`,
`Strict-Transport-Security`, and a `Permissions-Policy` scoped to this
origin's own mic/camera/screen. Every client's own document carries
`script-src 'self'`.

## WebSockets

Every gateway authenticates the handshake and closes the socket rather than
downgrading to anonymous, and caps its frame size — 64 KB for chat/presence,
256 KB for call/remote (`ws`'s 100 MB default would buffer a full frame in
the service's heap before any gateway code ran).

## Errors and logs

One error shape everywhere: `{ error: { code, message, requestId } }`. No
stack traces leave the process in production. Passwords, tokens, refresh
tokens, secrets, and FCM push tokens are never logged.

## Known gaps (decisions, not oversights)

- **A live socket outlives the token that opened it.** Disabling an account
  stops new sessions, but an already-open chat/presence socket keeps
  delivering until it disconnects on its own.
- **The rate limiter fails open** when Redis is unreachable — locking
  everyone out of login is judged the worse outage.
- **Rate-limit windows are fixed, not sliding** — a burst straddling two
  windows briefly gets double budget.
- **Refresh replay grace is per-process** — a replay landing on a different
  instance is still read as theft.
- **A picture's bytes aren't magic-byte inspected**, only its declared
  content type — contained by the download route deriving its content type
  from the key's extension and serving unknown types as attachments.
- **A push wakes a phone a mute can't reach** — quiet hours and mentions are
  decided on-device, after the wake-up, because the server can't read the
  ciphertext or know a timezone.
- **Metadata isn't protected** — the server knows who wrote to which
  channel and when, and message size. See [E2EE](/security/e2ee).

Full detail, including what to run to verify each of these (`pnpm -r
check`): [`development/SECURITY.md`](https://github.com/aiyu-ayaan/Nexora/blob/master/development/SECURITY.md).
