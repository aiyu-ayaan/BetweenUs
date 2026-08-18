# API security

Where the API decides who somebody is, what they may reach, and how much of it
they may ask for — and, at the end, what it still does not defend against.

`E2EE.md` covers the other half: what the server is unable to read even when it
is behaving perfectly. This document is about the server behaving correctly.

## The three questions, and where each is answered

Every request through the gateway passes three gates, and they are deliberately
in different places so that forgetting one does not silently disable the others.

| Question | Answered by | Where |
| --- | --- | --- |
| Who are you? | `JwtAuthGuard`, `authenticateHandshake` | `packages/auth`, `packages/websocket` |
| May you touch this? | `resolveChannelAccess`, `AdminGuard`, `RemoteService` | `packages/database`, per service |
| How often? | `rateLimit`, Nginx `limit_req` | `packages/nest-common`, `infrastructure/nginx` |

Identity is verified locally in every service from the signature on the access
token, with no round trip to auth-service. Authorization is *never* read from
the token: it says who you are and nothing about what you may do, because a role
changes and a fifteen-minute token would carry a stale one. Roles and grants are
read from the database on the request that needs them.

## Identity

**Access tokens** are HS256, fifteen minutes by default, and carry `sub`, the
email, the username and `type: 'access'`. **Refresh tokens** are separate: a
different secret, a `jti` that is a row in the database, and `type: 'refresh'`.
The two types cannot be spent as each other, and the secrets must differ — the
service refuses to start if they are the same, because two secrets that are one
secret leave the payload's type field as the only thing between them.

Verification names the algorithm. `jwt.verify` without `algorithms` accepts
whatever the token's own header asks for, which is a token telling the verifier
how to check it; both verifiers pin HS256 and both signers say it.

A signing secret is validated the first time it is read rather than trusted.
`.env.example` ships `JWT_SECRET="replace-me"`, and a deployment that copied the
file and never generated one would boot happily and sign real sessions with a
string that is in this repository. So the placeholders are refused everywhere,
and in production a secret must be at least 32 characters. Development keeps its
short test secrets, because a rule that stops people working is a rule that
acquires an override flag which then gets used in production.

**Refresh tokens rotate.** Presenting one revokes it and mints its successor,
and presenting a revoked one is read as theft: every live token for the account
dies and both parties have to sign in again. The exception is a short grace
window — `REFRESH_REPLAY_GRACE_MS`, thirty seconds by default — in which the
*same* pair is handed back again, because rotation is not atomic across a
network and a reload mid-refresh is otherwise indistinguishable from a theft. A
replay inside the window creates nothing new, so the detection outside it is
untouched. Tokens are stored as SHA-256 hashes; a database leak yields nothing
spendable.

**Passwords** are bcrypt at 12 rounds, minimum eight characters with a letter
and a digit. Login runs a comparison whether or not the account exists, against
a fixed dummy hash, so a missing account and a wrong password cost the same
time. Register answers the same message for a taken email and a taken username,
so neither can be probed for.

**OAuth** never lets the client near the client secret: the whole
authorization-code exchange happens server-side, and the client collects the
finished session with a one-time code that is single use and lives two minutes.

Two rules there are worth stating on their own, because both have teeth. The
redirect allow list is matched as *origins*, not as text — a prefix comparison
would let `https://nexora.example.attacker.test/` match an allow list naming
`https://nexora.example`, and that URL is where the one-time code travels. And
an existing account is found by email only when the provider says the address is
verified; Google will hand out one it has not verified, and linking on an
unverified address means anybody who can type a victim's email into a fresh
provider account walks into the account behind it. An unverified address does
not become a new account's address either, or it would sit there waiting for the
real owner to arrive and be linked to it.

**The mobile redirect is a private scheme, and a private scheme is not
exclusively ours.** A phone has no loopback server to come back to, so the
finished sign-in returns through `nexora://oauth` — and Android will not promise
that only this app is registered for it. Another app can claim the same scheme
and receive the one-time code. So the app scheme is accepted only for a sign-in
that also carries a challenge: the client keeps a random verifier, sends its
SHA-256 when it starts, and has to produce the verifier to exchange the code.
An app that intercepted the redirect holds a code it cannot spend. This is
RFC 7636's S256 exactly, so a client can use whatever PKCE code it already has,
and it is checked in constant time because it is a secret being compared. The
desktop's loopback redirect needs none of this — nothing else on the machine can
bind to a port that is already listening — and still sends no challenge.

## Authorization

**Channels** have one answer, in `packages/database/src/channel-access.ts`, and
chat-, call- and presence-service all call it rather than each keeping a copy.
A private channel is an allowlist that nothing overrides — not server
membership, not a role, not ownership. A direct message belongs to its two
participants. A channel the caller cannot see is answered as missing rather than
forbidden, so channel ids cannot be probed for.

**Permissions** are a built-in role's defaults, plus custom roles held, plus
individual grants, minus individual denials — and deny is applied last and beats
all three, so revoking one capability from one person works however many roles
they collect.

**Remote access** is never implied by a server role. Every remote permission is
granted per user per machine, with an optional expiry, and a session carries the
permissions it was issued with rather than re-deriving them. Revoking a grant
ends the sessions it authorized. Every refusal is audited, not only rejected: a
client that keeps asking for something it was not granted is worth being able to
see afterwards.

**Agent enrolment** hands out a 32-byte token once and stores only its hash. An
agent that loses it enrols again, which is also how a stolen one is revoked. A
machine id that belongs to somebody else cannot be re-enrolled into another
account, so a guessed uuid is not a takeover.

**Attachments** are authorized by the row, not by having a session. Holding an
account on the deployment is not an entitlement to every object on it: an
unclaimed upload belongs to whoever made it, and once a message carries it the
question becomes the one the message itself answers. Pictures — avatars and
server icons — are the deliberate exception and are public, because an `<img>`
tag cannot send an Authorization header; they are the only objects ever served
inline, and only after their content type has been checked against a raster
allowlist that excludes SVG.

## Rate limiting

Two layers, because they cover different failures. Nginx limits by address at
the edge, tightly on `/api/v1/auth` and `/api/v1/admin`. The service-level guard
in `@nexora/nest-common` is the backstop for traffic that reaches a service
another way, and it counts in Redis so every replica shares one budget.

Login carries two counters. An address budget alone is the wrong shape for the
attack that matters — a botnet spread over a thousand hosts gets the full
per-address allowance each, all of it aimed at one password — so a second bucket
counts against the *account being tried*, normalised so that two spellings of
one address are one bucket rather than two.

Changing a password and spending a refresh token have their own bucket. The
first checks the current password before accepting a new one, which makes it an
oracle for anybody holding a stolen access token; the second is a database write
available to anyone with a valid token. Separate from the credentials bucket, so
a shared address that ran out of login budget can still change its password.

Which address a request is counted against is a trust decision and is made
carefully. `x-forwarded-for` is read from the *right*, not the left: the gateway
appends to that header rather than replacing it, so its first entry is whatever
the caller wrote, and reading it would let anyone pick a fresh bucket per
request. `x-real-ip` is set with `proxy_set_header`, which replaces what
arrived, so it is preferred. Neither header means anything on a request that did
not come through the gateway, which is why the services sit on internal Docker
networks.

## Transport and headers

TLS terminates at Cloudflare. The tunnel carries HTTP and WebSocket only, never
media, and no inbound port is opened anywhere — both peers dial out.

The gateway sets `X-Content-Type-Options`, `X-Frame-Options`,
`Referrer-Policy`, `Strict-Transport-Security` and a `Permissions-Policy` that
keeps the microphone, camera and screen open to this origin (the web client asks
for all three) and closes every other device to everybody. The upload routes add
`default-src 'none'; sandbox`, so a document served from there — if one ever
were — loads nothing and runs nothing.

Note that `add_header` inside an Nginx location **replaces** the server block's
set rather than extending it. Any location that adds one of its own has to
restate what it inherits; `/api/v1/uploads` is the one that does.

The three clients each carry their own content security policy in their
document, `script-src 'self'` in all of them, so nothing any of them fetches can
become code.

CORS allows credentials only when `CORS_ORIGIN` names the sites they may come
from. A wildcard origin with credentials is a pair no browser honours, and this
API has no cookie to send: every client attaches a bearer token itself.

## WebSockets

All four gateways authenticate the handshake and close the socket rather than
downgrading to anonymous. Browsers cannot set headers on a WebSocket handshake,
so the token may arrive in the `Sec-WebSocket-Protocol` header or a query
parameter; the Nginx access log records `$uri`, not the query string.

Every gateway caps its frame size. `ws` defaults to 100 MB, and a signed-in
client sending one has it buffered in the service's heap before a line of
gateway code runs. Chat and presence carry subscriptions and typing flags and
get 64 KB; call and remote carry an SDP and a person's clipboard selection and
get 256 KB. Nothing on these sockets is bulk — media is a peer connection.

Chat re-checks channel access on every `channel.subscribe`, because permissions
change mid-session. A remote session is authorized by its row, which was issued
to one person over HTTP after the grant was checked, so presenting somebody
else's session id is not a way in.

## Errors and logs

One error shape everywhere: `{ error: { code, message, requestId } }`. Stack
traces never leave the process, and in production an unhandled error is
`INTERNAL_ERROR` and nothing more. Every request carries a request id, reused
from the caller when it sends one, so a trace survives a hop between services.

Passwords, tokens, refresh tokens and secrets are never logged. A refresh-token
reuse is logged as a warning with the account and the reason, which is the
signal that a token was stolen.

## Known gaps

These are decisions, not oversights. They are here so nobody has to rediscover
them.

**A live WebSocket outlives the token that opened it.** Disabling an account
stops new sessions and stops a refresh being spent, so a stolen access token is
useless within fifteen minutes — but a chat or presence socket that was already
open is not re-checked and keeps delivering until it disconnects. Fixing it by
expiring sockets at the token's expiry is wrong as stated: a call socket closing
is a call ending, and doing that every fifteen minutes is worse than the gap.
The shape that works is a revocation event on Redis that the gateways subscribe
to, which is a piece of work rather than a line.

**The rate limiter fails open.** When Redis is unreachable the guard returns
true. Locking everybody out of login is the worse outage, and Nginx's
per-address limit is still standing.

**Windows are fixed, not sliding.** A burst that straddles two windows gets
twice the budget for a moment. A sorted-set sliding window is the upgrade if
that ever matters.

**Refresh replay grace is per process.** A replay that lands on a *different*
auth-service instance is still read as theft and signs the account out. Move the
map to Redis before running more than one instance.

**A picture's bytes are not inspected.** The upload is checked against the
declared content type, not against magic bytes, so a file can claim to be a PNG
and be anything. It is contained rather than exploitable: the download route
derives the content type from the key's extension rather than from what was
declared, sends `nosniff`, and serves anything that is not a known raster type
as an attachment.

**A controller's remote events reach the agent unread.** The gateway checks the
permission the event type requires and forwards the event itself without
inspecting its fields. The agent is what has to validate a click coordinate or a
key code, because the gateway would only be guessing at what the machine on the
other end considers sane.

**Metadata is not protected.** The server knows who wrote to which channel and
when, how large each message was, and who is in a voice channel. See `E2EE.md`.

## What to run

```
pnpm --filter @nexora/auth check          # tokens, secrets, algorithm pinning
pnpm --filter @nexora/nest-common check   # client address, CORS, rate buckets
pnpm --filter auth-service check          # login, rotation, reuse, OAuth redirects
pnpm --filter @nexora/permissions check   # role and grant resolution
pnpm --filter @nexora/storage check       # keys, allowlists, inline safety
```

Or `pnpm -r check` for all of them.
