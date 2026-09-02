---
sidebar_position: 1
---

# Security Overview

Where the API decides who somebody is, what they may reach, and how much of
it they may ask for — condensed from
[`development/SECURITY.md`](https://github.com/aiyu-ayaan/BetweenUs/blob/master/development/SECURITY.md),
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
- **Password recovery leaks nothing about who has an account.** An account
  that doesn't exist, one that does, and a disabled one all get the identical
  answer from `/forgot-password`. Reset tokens are stored as SHA-256, are
  single use, burn any previous live token when minted, and revoke every
  session for the account when spent. The administrator-granted door is a
  *window* that expires, not a flag, and opening or cancelling it is audited.
- **SMTP credentials are operator data**, sealed under `SETTINGS_SECRET` in
  the database and never readable back through the panel. A deployment with
  no mail server is supported: clients say to ask an administrator.
- **Usernames are lower-cased on write**, so the unique index and the
  username login path agree. The availability endpoint's Bloom filter has no
  false negatives, so it can save a query but never invent a refusal — the
  unique constraint is still what decides.

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
- **Blocking** is enforced inside `resolveChannelAccess` and nowhere else.
  The row is directional and the check reads both directions, so everything
  downstream of a channel id — history, pins, reactions, calls, typing —
  closes through one function. A blocked conversation answers 404 like any
  unseen channel, so neither the block nor its direction can be probed for.
- **Clearing your own history is a filter, not a delete.** Two markers —
  `User.chatsClearedAt` for all conversations, `ChannelRead.clearedAt` for
  one — and the later of the two is the floor applied by history, pins and
  unread counts. No endpoint can remove the other participant's copy of a
  message.

## Rate limiting

Two independent layers: Nginx by address at the edge (tight on `/auth` and
`/admin`), and a Redis-backed service-level guard as the backstop for
traffic that reaches a service another way. Login has **two** counters — by
address and by the normalized account being tried — because a botnet spread
over many addresses defeats an address-only budget aimed at one password.

`X-Forwarded-For` is read from the right, not the left (Nginx *appends*, so
the first entry is whatever the caller wrote); `X-Real-IP`, set with
`proxy_set_header` and therefore unspoofable, is preferred.

### The window slides

It used to be fixed — one `INCR` on a key carrying `floor(now / window)` — which
refills the whole budget at a boundary an attacker can compute as easily as the
server can. Twenty attempts in the last second of one minute and twenty in the
first second of the next is forty attempts in two seconds, from a limit that
reads "20 per minute". The average was never the problem; the burst is.

Each bucket is a sorted set scored by arrival time, and one `MULTI` per bucket
prunes what has aged out, adds this request, trims, counts and re-arms the TTL —
one round trip, atomic, and with no window in the key, so there is no boundary to
straddle.

A request is counted before it is judged, so hammering is never free. And a
bucket is capped at twice its budget: a sorted set holds a member per request, so
an address being hammered would otherwise grow a key without bound for a whole
window — turning the endpoint that exists to stop resource exhaustion into a way
of causing it. Trimming the oldest entries changes no answer, because the count
is only compared against the budget and the cap is above it.

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

### The interrupted rotation

Rotation is not atomic across the network: the server revokes a token, mints its
successor, and the response is lost. The client then presents the token it still
has — the spent one — which without a grace window is indistinguishable from a
stolen token, and signs every device out over a dropped packet.

Inside `REFRESH_REPLAY_GRACE_MS` (30 s) the reply is the *same* pair rather than
a new one, so a replay creates nothing. The answer lives in Redis under
`auth:rotated:<jti>`, not in one process's memory — which is what lets more than
one auth-service instance run behind the gateway.

The entry carries the time it was written and the read compares it against the
window as it is *now*; the key's TTL is the cleanup rather than the decision, so
shortening the window takes effect immediately instead of after the old one
elapses. An in-process map is still read first and still answers when Redis is
unreachable, because a Redis outage turning every interrupted rotation into a
sign-out would be worse than the per-process behaviour this replaced.

### A socket that stops when the account does

A handshake is authenticated once, and everything after it is trusted because
the socket is still open. Disabling an account therefore used to stop new
sessions and leave every socket it already had delivering until it happened
to disconnect — which for a call socket is "until the call ends".

Expiring sockets at the access token's expiry is the wrong fix: a call socket
closing *is* a call ending. Instead a `session.revoked` event on Redis reaches
every gateway. Nothing happens on a healthy deployment.

The event carries a **timestamp, not a flag**. A socket goes if the token that
opened it was issued strictly before `notBefore`, and stays otherwise — which
makes "sign every session out" and "sign every *other* session out" the same
event with the line drawn in a different place:

| What happened | Where the line is drawn |
| --- | --- |
| An administrator disabled or deleted the account | `now` — nothing survives |
| The password changed | `now`, and the pair that request hands back is dated *at* the line, so the person changing it stays signed in and anyone else is dropped |
| A refresh token was replayed or forged | `now` |

A plain sign-out publishes nothing: it ends one device's chain, and a gateway
cannot tell one of an account's sockets from another.

The close code is **4403**, distinct from 4401 (never authenticated). A client
that retried 4403 with the same token would succeed — it is still signed and
unexpired — and would undo the revocation, so 4403 means "your session is over",
not "get a new token".

Agent sockets on `remote-gateway` are exempt: they are authenticated by the
machine's own token rather than anybody's session. The controller socket is the
one that goes, ending the session the way an ordinary disconnect would.

## What one account may learn about another

Presence is scoped, never broadcast to everybody connected: `audience.ts` answers
"who may hear about this user" as the people who share a server or an accepted
friendship, and the same set scopes the events, the initial sync and the
last-seen query. The symmetry is what makes it cheap — the set of people allowed
to hear about a user is the set that user is allowed to hear about — so an event
is scoped once rather than once per recipient.

**Last seen has its own setting on top of that** — `everyone` / `friends` /
`nobody`, where `everyone` means the audience above and not the world. `nobody`
is reciprocal: an account that hides its own does not get to read anybody else's,
which is what keeps the setting from being a one-way mirror. It is enforced in
`PresenceStore.lastSeenOf`, the only way to reach the value, and never by a
client hiding something it was sent.

An excluded timestamp is **absent rather than refused**, and absent is exactly
what a brand-new account looks like — so a missing line cannot be used to test
for the setting, or for its tier. The status still arrives; a query that went
silent would itself be an answer.

`invisible` is a different switch and does a different thing: it hides that you
are here *now*, and freezes the last-seen value at the last moment you were
genuinely visible rather than letting it tick along behind the disguise.

## Clocks

**No expiry is ever decided on a device clock.** A device clock belongs to
whoever holds the device — it can be wound forward or back in Settings — so
anything with a deadline is compared against a clock that person does not own:
refresh tokens and password resets against the auth service's, remote-access
grants against the database's (`resolveRemoteAccess`), invite links against the
server service's (`inviteUsable`), upload tickets against the chat service's.
Both of those arrived, and both obey it. `Message.expiresAt` is stamped by the
chat service from its own clock and the sweeper deletes against the same one; a
one-time message is destroyed by `POST /messages/:id/burn`, a server endpoint,
before the client that called it has closed the viewer.

The clients do prune on a 30-second ticker, and that is not the mechanism.
It exists so a device that was asleep when a window closed stops drawing
decrypted copies the server has already destroyed. Winding a phone forward
makes messages vanish sooner **on that phone only**; winding it back does
nothing at all, because the rows are already gone and no history page will
return them.

Clients still need to *show* the time, and for that they carry the server's
clock rather than their own. Every HTTP response already includes a `Date`
header, so each reply is one free NTP-style sample — the server stamped it
somewhere inside the round trip, so the midpoint is the estimate and the
least-delayed sample wins — and the offset that falls out drives every label
that says when something happened: day dividers, read receipts, an invite's
"Expired". `services/server-clock.ts` on desktop and web, `ServerClock.kt` on
Android, the same cases and a test on both sides. Past five minutes of skew a
strip at the top of the app says the device's clock is wrong and roughly how
far, because a chat that files yesterday under "Today" reads as broken software
rather than as a wrong clock.

No timezone is sent anywhere, and none is needed: timestamps are UTC on the
wire (`toISOString()`), no client mints one, and each client renders in its own
zone. A reader's timezone is not something the server has to know, so it is not
something it collects.

## Errors and logs

One error shape everywhere: `{ error: { code, message, requestId } }`. No
stack traces leave the process in production. Passwords, tokens, refresh
tokens, secrets, and FCM push tokens are never logged.

## Known gaps (decisions, not oversights)

- **The rate limiter fails open** when Redis is unreachable — locking
  everyone out of login is judged the worse outage.
- **A picture's bytes aren't magic-byte inspected**, only its declared
  content type — contained by the download route deriving its content type
  from the key's extension and serving unknown types as attachments.
- **A push wakes a phone a mute can't reach** — quiet hours and mentions are
  decided on-device, after the wake-up, because the server can't read the
  ciphertext or know a timezone.
- **A block doesn't unshare a server** — it closes the direct message; both
  people are still members of any room they both joined.
- **`chatsClearedAt` hides rather than redacts** — the ciphertext is still
  in the table and in every backup taken since.
- **Last-seen privacy does not bind an administrator.** The admin panel reads
  `users.lastSeenAt` directly whatever the account chose, because an operator
  can read their own Postgres with or without this code — the panel shows the
  setting beside the value rather than pretending to honour it.
- **Hiding last seen does not hide being online.** The two are separate
  switches: `nobody` stops the timestamp, and only `invisible` stops the dot.
- **The username Bloom filter is per process** — a name registered against
  another instance reads as available here until this one restarts, and the
  unique constraint then refuses the registration.
- **A password reset costs the identity backup** — it's sealed with the old
  password, so a machine signing in for the first time afterwards reads what
  arrives from then on, not what came before. Inherent to end-to-end
  encryption; see [E2EE](/security/e2ee).
- **Metadata isn't protected** — the server knows who wrote to which
  channel and when, and message size. See [E2EE](/security/e2ee).

Full detail, including what to run to verify each of these (`pnpm -r
check`): [`development/SECURITY.md`](https://github.com/aiyu-ayaan/BetweenUs/blob/master/development/SECURITY.md).
