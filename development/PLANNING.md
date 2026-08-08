# Nexora Development Planning

Living document. `CLAUDE.md` is the target architecture; this file records how
we get there in stages and what each stage delivers.

## Phase map

| Phase | Name | Delivers | Status |
| --- | --- | --- | --- |
| 0 | Scaffold | Monorepo, workspaces, empty service folders | Done |
| 1 | Dev infrastructure | Postgres + Redis via Docker Compose, env template | Done |
| 2 | Shared packages | shared-types, config, logger, auth, permissions, events, database (Prisma) | Done |
| 3 | Auth service | Register, login, refresh rotation, `/me`, `/health` | Done |
| 4 | Workspace service | Workspaces, members, channels | Done |
| 5 | Chat service | Message REST + WebSocket gateway + Redis fanout | Done |
| 6 | Gateway | Nginx REST/WebSocket routing, rate limits, prod compose | Done |
| 7 | Desktop client | Electron + React + Tailwind + Zustand, end-to-end chat | Done |
| 8 | Encrypted chat + voice | E2EE messages, LiveKit voice channels, two-window dev harness | Done |
| 9 | Presence | presence-service, online status, typing indicators, voice rosters | Done |
| 10 | Hardening | Tests, CI, error contract polish, request IDs everywhere | In progress |
| 11 | Admin panel, OAuth, notifications | Admin web app, Google/GitHub sign-in, desktop notifications | Done |
| 12 | Servers, permissions, DMs | Workspace renamed to server, per-member permissions, private channels, friends and direct messages, Discord-parity client | In progress |
| 13 | Remote desktop | remote-gateway, remote-agent, remote permissions, audit log | Planned |
| 14 | Production ingress | Cloudflare Tunnel, TLS, secret management, deploy pipeline | Planned |

Hardening moved to phase 10: encryption changes the message format and presence
adds a service, so both were cheaper to land before tests were written against
the older shape.

## Architecture decisions made so far

### Servers, permissions and direct messages (phase 12)

- **"Workspace" is renamed to "server" everywhere, not just in the UI.** Discord
  calls the thing a server and so does everyone using this product; keeping a
  second word for it in the schema, the routes and the types would mean
  translating in every conversation and in every code review forever. The rename
  reaches the Prisma models (`Server`, `ServerMember`, `ServerRole`), the REST
  surface (`/api/v1/servers`), the service directory (`server-service`) and the
  client. It is a mechanical change, and it is cheapest now, while there is one
  schema and four callers.
- **Permissions are a role plus per-member overrides, not a role system.**
  Discord's model is custom roles with permission bitfields, colours and an
  ordering, and most of that machinery exists to serve servers with thousands of
  members. What was actually asked for is that an administrator can give one
  person one capability. So `ServerMember` keeps its role and gains two arrays -
  granted and denied - and the effective permission set is
  `roleDefaults ∪ granted \ denied`. Custom named roles can be layered on later
  without changing any call site, because every call site asks the same
  question: does this member hold this permission.
- **One effective-permission resolver, used by all four services.** Chat, call
  and presence each carried their own copy of "look up the channel, look up the
  membership, check the role", which is three places to forget about private
  channels and direct messages. The lookup moves into `@nexora/database` as
  `resolveChannelAccess`, and the three services call it. It is the same
  shortcut as the shared schema, and it splits the same way: when each service
  owns its data this becomes an RPC with an unchanged signature.
- **A private channel is an allowlist, not a permission.** Membership of a
  server no longer implies membership of every channel in it: a channel is
  either open to the server or restricted to the users named on it, chosen when
  it is created. Modelling it as a permission would have meant inventing a
  permission per channel; a `ChannelMember` row per person is the smaller idea
  and the one that answers "who can read this" directly - which is also the
  question the E2EE key wrapper has to answer, so private channels get
  encryption scoped to their allowlist for free.
- **A direct message is a channel with no server.** DMs need history, paging,
  realtime fanout, notifications, unread counts and end-to-end encryption -
  every one of which already exists for channels. A second message model would
  duplicate all of it. So `Channel.serverId` becomes nullable, `DM` joins the
  channel types, and the two participants are `ChannelMember` rows. Everything
  downstream of the channel id keeps working untouched.
- **Friendship is one row, ordered by user id.** A request and an acceptance are
  the same relationship in two states, so storing one row with a requester, an
  addressee and a status avoids the reconciliation that two rows would need. The
  pair is stored with the lower id first and a unique constraint on it, because
  the alternative is two people sending each other a request and both being
  right.
- **Only friends can open a direct message.** Anyone can search for a user by
  name, because that is how a request gets sent at all, but a channel is only
  created between accepted friends. Without that rule the search endpoint is a
  spam surface, and adding a block list later has one place to hook into.
- **Status is a claim by the client, presence keeps the truth.** Online, idle,
  do not disturb and invisible are what the user chose; connected or not is what
  the server knows. Redis holds both, and invisible is resolved server-side to
  `offline` before anyone else is told - a status that leaks in the payload is
  not invisible. The user's own client still sees its real status, so the
  picker can show what was picked.
- **Global settings are a full-screen overlay, and server settings are their
  own screen.** They are different jobs at different scopes and Discord splits
  them for that reason: one is about this account and this installation, the
  other about one community. Nothing about boosting or scheduled events exists
  in this product, so neither section exists in the settings it would sit in.
- **The E2EE badge is gone from the channel header.** Encryption is not a
  feature that needs advertising in the corner of every conversation; it is
  either on for everything or the join is aborted, which is already the rule for
  media. The padlock stays where a failure would be actionable - the voice
  panel - and `E2EE.md` still documents the design.

### Admin panel, OAuth and notifications (phase 11)

- **The admin panel is its own web app, not a screen in the desktop client.**
  Operating the platform and using it are different jobs; a browser reaches the
  panel from anywhere and needs no install. It is `apps/admin`, served under
  `/admin` by the same gateway, and it talks to the same API as everything else.
- **The panel has no sign-up; the first administrator comes from the CLI.**
  `pnpm admin:create` runs where the database already is, which is the only
  place that proves the operator owns the deployment. A page open to the
  internet that mints the first admin is a race anyone can win. When no
  administrator exists the panel says which command to run rather than offering
  a form, and the generated password is printed once and must be replaced on
  first login - it has been in a terminal, and terminals have scrollback.
- **Admin authorisation is a database lookup, not a token claim.** A 15-minute
  access token would carry a role that a demotion cannot take back. Admin
  traffic is rare, so the lookup costs nothing that matters.
- **OAuth credentials live in the database, entered in the panel.** Enabling
  Google or GitHub sign-in is an operator action, not a redeploy, and the
  clients discover which providers to offer by asking - nothing is hard-coded
  into a login screen. Client secrets are sealed with AES-256-GCM
  (`SETTINGS_SECRET`, falling back to `JWT_SECRET`) and never sent back out.
- **The OAuth exchange happens in auth-service, and the browser does the
  provider part.** The client secret must not reach a client, and Google
  refuses embedded webviews - so the desktop app opens the real browser,
  auth-service trades the code for a profile, and the finished session comes
  back to a loopback server as a one-time code the client redeems. The same
  shape serves a future web client, with an allowed origin instead of loopback.
  The redirect target is restricted to loopback plus `OAUTH_ALLOWED_REDIRECTS`,
  because an open redirect here hands sessions to whoever asks.
- **A provider login links before it creates.** Provider account id first, then
  verified email, and only then a new account - otherwise signing in with
  Google after registering with the same address silently forks the person into
  two accounts.
- **Notifications are decided in the renderer and delivered by the main
  process.** Only the renderer knows whether the channel is on screen and the
  window focused; only the main process can raise an OS notification, flash the
  taskbar and restore a hidden window. The rule is one line: notify unless the
  user can already see it.
- **The client subscribes to every text channel it can read, not just the open
  one.** Without that, a message in another channel never reaches the client and
  there is nothing to notify about. Unread counts fall out of the same change.

### Earlier decisions

- **One Prisma schema in `packages/database` for the MVP.** Per-service
  databases are the target, but three services against one schema keeps the MVP
  diff small. Splitting is a migration, not a rewrite: each service already
  accesses only the models it owns.
- **Redis Pub/Sub for chat fanout.** Chat WebSocket gateway publishes to
  `chat.message.created` and every instance re-broadcasts to its local sockets.
  This makes `chat-service` horizontally scalable from day one.
- **JWT verified locally in every service** using `@nexora/auth`, no auth
  round-trip per request. Access tokens are short-lived (15m), refresh tokens
  are stored hashed in Postgres and rotated on use.
- **Storage driver chosen by environment, local disk by default.** A developer
  should not need MinIO or an AWS account to upload a file, so an empty S3
  config means local disk under `LOCAL_STORAGE_PATH`. Production sets the S3
  variables and the same code path uses the bucket.
- **Nginx as internal gateway**, no business logic. Cloudflare Tunnel is a
  separate, later concern (phase 13).
- **Media never passes through NestJS.** `call-service` mints LiveKit access
  tokens and nothing else; the desktop client dials the SFU directly.
- **One channel key, shared by chat and voice.** A member who can read a channel
  can join its voice room, so a second key exchange for media would add code and
  no security. Design and limits: `E2EE.md`.
- **Voice is a channel type, not a button on a text channel.** Discord's model:
  `VOICE` channels are joined and show who is inside, so presence answers "who
  is in there" without anyone joining first. The earlier per-text-channel call
  button was removed.
- **A voice channel owns the main content area.** Selecting one swaps the chat
  view for `VoiceChannelView`, the way Discord does it: the first click joins
  and opens the screen, later clicks only reopen it. Cameras and shared screens
  are shown there, where there is room for them, and the sidebar panel is left
  as a compact status readout. The connection itself lives in the voice store,
  so navigating to a text channel does not end the call - only the tiles go
  away. When this client is not in the call the roster comes from presence,
  which has names but no media; once connected it comes from LiveKit.
- **A shared screen is its own stage, not a bigger tile.** Camera and screen are
  separate publications in LiveKit and separate things on screen: a share never
  takes over the sharer's tile. Everyone else gets a "NAME is sharing" banner
  with a way in, and choosing it opens the theatre layout - the screen large,
  the faces on a strip underneath - which is what a group watching something
  together wants. Nobody is dragged into a stream they did not open.
- **The grid pages instead of shrinking.** Nine tiles a page with pager arrows,
  and whoever spoke in the last minute is pulled to the front, so an active
  speaker is on page one without the grid reshuffling on every word. Teams'
  bargain. Speaking is marked in amber on the tile.
- **Chromium asks which screen to share too late to ask the user.** The
  `setDisplayMediaRequestHandler` callback fires during capture, with no way to
  put a chooser up and wait, so the order is inverted: the renderer lists the
  sources over IPC, shows its own picker, records the choice in the main
  process, and only then starts the capture the handler answers. The choice is
  consumed once, so a capture that skipped the picker falls back to the primary
  screen rather than silently re-sharing the last one.
- **Presence is its own service.** `presence-service` owns `/ws/presence`,
  keeps online/typing/voice state in Redis and fans changes out over Pub/Sub.
  Typing and voice rosters could have ridden the chat socket, but presence is a
  separate concern with a separate lifecycle, and the architecture already
  reserved the service.
- **LiveKit is dialled on `127.0.0.1`, not `localhost`.** Chromium resolves
  `localhost` to `::1` first and the container publishes IPv4 only, so the
  client silently failed to reach the SFU.
- **Ciphertext lives in `messages.content`.** Encryption needed no schema change
  for messages and no service change beyond the size limit, because the server
  already treated the body as an opaque string.
- **A leaked refresh token signs out the whole account.** Rotation alone lets a
  thief keep a stolen token alive: whoever refreshes first wins and the other
  party never finds out. Presenting a token that was already spent now revokes
  every live token for that account, because the server cannot tell victim from
  thief. The cost is a re-login after a genuine race (two windows refreshing at
  once), which the desktop client already avoids with single-flight refresh.
- **Rate limiting lives in Nginx and in the service.** The edge limit is the one
  that carries the load, but it only covers traffic that came through the edge.
  Credential endpoints keep a Redis-counted budget of their own so a container
  on the internal network, a port-forward or a future second gateway is limited
  too. Redis being down fails open: locking everyone out of login is the worse
  outage.
- **`AuthService` takes its Prisma slice through an injection token.** Every
  other service imports the `prisma` singleton directly, and that stays; auth is
  the one whose logic is worth testing without a database, so it is the one that
  gets the seam.
- **Request ids are assigned in `bootstrapService`, not per module.** One
  middleware, mounted before routing, means an id exists even for a request that
  reaches no controller, and no service can forget to wire it. It logs one line
  per completed request - id, user, method, path, status, duration - and skips
  `/health` so probes do not drown the log.
- **CI runs the smoke scripts rather than a second test suite.** The scripts
  already walk the real REST and WebSocket surface end to end, so the cheapest
  useful CI is to give them Postgres and Redis service containers and run them.
  They had to learn to exit non-zero first - a failed assertion used to print
  `ok false` and pass.
- **The E2EE key directory lives in `chat-service`.** Device public keys are
  user-level data and belong in `user-service` once it exists; putting them in
  chat-service kept this to one module, one Nginx route and one client service.
  Same class of shortcut as the shared Prisma schema.

## Running the stack

```bash
cp .env.example .env
docker compose -f infrastructure/docker/docker-compose.dev.yml up -d
pnpm install
pnpm db:generate && pnpm db:migrate
pnpm dev
```

Desktop app: `pnpm --filter @nexora/desktop dev`.

Two signed-in windows for testing chat, voice and presence: `pnpm dev:duo` —
see `TESTING.md`.

## Verification status (as of phase 10, in progress)

Run live on 2026-08-08, on top of everything verified in phase 9 below:

- `pnpm --filter @nexora/auth-service check` drives register, login, refresh
  rotation, reuse detection, logout and `/me` against an in-memory database.
- Rate limiting observed: 24 rapid logins against a running auth-service gave
  401 until the budget ran out, then 429.
- Both smoke scripts pass against the running stack:
  `apps/services/chat-service/smoke.mjs` and
  `apps/services/presence-service/smoke.mjs`.
- Request logging observed: one line per request carrying `requestId`, and
  `userId` on authenticated routes.
- **The container stack runs**: images build, the `migrate` service applies the
  schema, and register / login / workspace list / workspace create / the message
  and call routes answer through Nginx, with `x-request-id` passed through from
  the caller. Two bugs found doing it - no migration step, and no OpenSSL in the
  images - are fixed.

Still unverified: CI itself has not run yet (the workflow lands with this
phase), and the human-in-front-of-it items below.

### Phase 11 verification

Run live against the development stack on 2026-08-09:

- `pnpm admin:create` creates `nexoraadmin` and prints a generated password;
  the account is ADMIN with `mustChangePassword` set.
- Login by username works; the admin API answers `PASSWORD_CHANGE_REQUIRED`
  until the password is changed, then serves the directory.
- Promote, demote, disable, enable and delete all work; self-demotion is
  refused (`CANNOT_DEMOTE_SELF`), a non-admin gets 403 and an anonymous caller
  401.
- Enabling a provider without a secret is refused (`INCOMPLETE_PROVIDER`); with
  one, `GET /api/v1/auth/oauth/providers` starts listing it, and disabling it
  removes it again. The stored secret is never returned - only `hasSecret`.
- The panel itself was driven in a browser: bootstrap gate, login, users table
  with 19 accounts, provider page showing the callback URL to register, and the
  account page.

Not yet exercised: a real Google or GitHub client (the exchange has only been
tested against the panel's own stored credentials), and the panel behind the
gateway container rather than the dev server.

### Phase 9 verification

Run live against Docker (Postgres, Redis, LiveKit in WSL) on 2026-08-08:

- `pnpm build`, `pnpm typecheck` and `pnpm check` pass across every workspace
  task, including the desktop crypto self-check.
- `20260808150000_e2ee_keys` applied to a real Postgres; `device_keys` and
  `channel_keys` exist.
- `apps/services/chat-service/smoke.mjs` passes end to end, including the E2EE
  section: device directory, key publish/fetch, and epoch-ordering rejection.
- `pnpm dev:duo` opens two signed-in windows; both reach chat and presence.
- **Encrypted chat between two clients works**: Alice and Bob exchanged
  messages, and `channel_keys` holds one wrapped key per member (epoch 1,
  sealed by Alice) while `messages.content` holds ciphertext envelopes.
- Voice tokens: `call-service` mints a LiveKit token for a channel member,
  refuses a non-member with 404, and the LiveKit signal socket accepts that
  token over `ws://127.0.0.1:7880`.
- **Two clients in one voice channel**: both participants reach `participant
  active` in LiveKit over UDP and publish `audio/opus` with `encryption: 1`,
  which is the end-to-end encrypted path - the SFU forwards frames it cannot
  decode. One client sees the other's `trackPublished`.
- presence-service: both clients connect to `/ws/presence`, appear in the Redis
  online set, and the voice roster in Redis lists both members of the channel.
  A scripted client reproduces `presence.sync` and `voice.changed`.
- The member list showed "2 online" with green dots in the running app, and the
  voice roster under the channel named the connected member.
- Voice roster join/leave verified with a scripted presence client: listed after
  `voice.join`, gone after `voice.leave`.

Not yet exercised:

- Audio actually heard by a human on each end, camera, and screen share.
- Typing indicators observed in the UI (the events are wired and the server
  publishes them, but nobody has watched one land).

### Fixed: publishing failed against an outdated SFU

Joining reported *"the microphone did not start (negotiation timed out)"* while
the connection itself was up, and the mic, camera and screen-share buttons all
failed the same way afterwards. LiveKit's debug log named it:

```
Initial connection failed: v1 RTC path not found.
Consider upgrading your LiveKit server version - Retrying
negotiation due to track publish failed, retrying after reconnect
```

The root cause is a protocol gap, not ICE or a permission. `livekit-client`
tags every publisher offer with an incrementing `SessionDescription.id` and
resolves the publish only when an answer echoes an id past that checkpoint.
`livekit/livekit-server:v1.7` predates that field, so its answers came back
with id `0`, the client's `OfferAnswered` check never passed, and every publish
- microphone, camera, screen share - rejected on the 15s deadline even though
the SDP answer had been applied. Media was never the problem, which is why the
room still connected and the roster still populated.

Fixed by moving both compose files to `livekit/livekit-server:v1.13.5`. The
image tag must now be kept in step with the `livekit-client` version in
`apps/desktop`.

Two other causes were ruled out along the way and are fixed: a hot reload used
to leave an orphaned Room connected under the same identity, which LiveKit
answers by kicking the older session (`DUPLICATE_IDENTITY`), and clicking an
already-joined channel did the same thing.
- Redis Pub/Sub fanout across two instances of the same service.

## Running the whole stack in containers

```bash
docker compose -f infrastructure/docker/docker-compose.yml up -d --build
```

Reads `.env` for secrets and refuses to start without `JWT_SECRET`,
`JWT_REFRESH_SECRET` and the `LIVEKIT_*` values. The `migrate` service applies
the schema before anything serves traffic. Nginx listens on `8080`; public
ingress through `cloudflared` is opt-in with `--profile public`.

## Admin panel

```bash
pnpm admin:create        # once, prints a username and a generated password
pnpm dev:admin           # http://localhost:5174/admin/
```

In a container deployment the panel is served at `/admin` by the gateway. The
first login forces a password change; after that, Users manages accounts and
Sign-in providers configures Google and GitHub. Enabling a provider is what
makes its button appear on the desktop login screen - clients ask the server
which providers to offer and draw nothing that is not configured.

Google and GitHub need the callback URL the provider page prints, which is
built from `PUBLIC_API_URL`. Behind Cloudflare that is the public hostname, not
`localhost`.

## Continuous integration

`.github/workflows/ci.yml` runs on every pull request and on `master`:

| Job | Does |
| --- | --- |
| `verify` | install → lint → typecheck → build → `pnpm check` (package self-checks) |
| `integration` | Postgres + Redis service containers, migrations, four services started from their builds, then both smoke scripts |

## Companion documents

- `MVP.md` — what the first runnable version covers
- `E2EE.md` — encryption design, threat model and its known limits
- `TESTING.md` — running two clients locally (`pnpm dev:duo`)
- `TODO.md` — ordered backlog

## Conventions

- TypeScript strict everywhere. No `any` in committed code.
- Controllers thin, services hold logic, Prisma access stays in services.
- Every service exposes `GET /health`.
- API errors use the shape in `CLAUDE.md` §24 (`code`, `message`, `requestId`).
- Commits: conventional commits (`feat:`, `fix:`, `chore:`, `docs:`).
