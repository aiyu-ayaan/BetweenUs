# Deploying BetweenUs

This is the step-by-step for putting BetweenUs on a server: what to generate, what
to set, how to create the first administrator, how to publish it through a
Cloudflare Tunnel, and why each endpoint has to be on that tunnel.

`README.md` describes what BetweenUs is. `CLAUDE.md` is the target architecture.
This file is the operational path from a bare host to a working deployment, and
it states the gaps a deployment still has rather than implying there are none.

---

## Contents

1. [What a deployment is](#1-what-a-deployment-is)
2. [Before you start](#2-before-you-start)
3. [Step 1 - the code and the environment](#3-step-1---the-code-and-the-environment)
4. [Step 2 - decide whether you need a TURN relay](#4-step-2---decide-whether-you-need-a-turn-relay)
5. [Step 3 - bring the stack up](#5-step-3---bring-the-stack-up)
6. [Step 4 - create the first administrator](#6-step-4---create-the-first-administrator)
7. [Step 5 - the admin panel](#7-step-5---the-admin-panel)
8. [Step 6 - OAuth sign-in](#8-step-6---oauth-sign-in)
9. [Step 7 - public ingress with Cloudflare Tunnel](#9-step-7---public-ingress-with-cloudflare-tunnel)
10. [Which endpoints the tunnel must carry, and why](#10-which-endpoints-the-tunnel-must-carry-and-why)
11. [What does not go through the tunnel](#11-what-does-not-go-through-the-tunnel)
12. [Step 8 - the desktop client](#12-step-8---the-desktop-client)
13. [File storage](#13-file-storage)
14. [Verifying the deployment](#14-verifying-the-deployment)
15. [Day two - backups, upgrades, logs](#15-day-two---backups-upgrades-logs)
16. [Known gaps](#16-known-gaps)
17. [How the images are built, and why rebuilds are quick](#17-how-the-images-are-built-and-why-rebuilds-are-quick)
18. [One data path, and automatic backups](#18-one-data-path-and-automatic-backups)

---

## 1. What a deployment is

One host, one public hostname, one Docker Compose project.

```
                        Internet
                           │
                    Cloudflare (TLS)
                           │
                   Cloudflare Tunnel            no inbound port is opened
                           │
                  ┌────────▼────────┐
                  │  Nginx :8080    │           routing, rate limits, caps,
                  │  api-gateway    │           WebSocket upgrade
                  └────────┬────────┘
       ┌──────────┬────────┼─────────┬──────────┬──────────┐
    auth:3001  server:3003 chat:3004 presence  notification  call:3007
                                      :3005      :3006       remote:3008
                           │
                 ┌─────────┴─────────┐
            PostgreSQL:5432      Redis:6379          (no published ports)

   Desktop A ◀────── WebRTC media, direct, no server ──────▶ Desktop B
```

Every service is a container built from this repository, on its own private
Docker network. Postgres and Redis publish nothing. Nginx is the only thing on
the host port, and with a container tunnel it does not even need that.

Two things travel outside the gateway, and both are deliberate:

- **WebRTC media** goes from one client straight to another. There is no media
  server in this stack, nothing on the host carries a frame, and no port is
  published for it. What the gateway carries is the signalling that sets it up.
- **Remote agents dial out.** Nothing ever connects towards a controlled
  machine, and `3389` is published nowhere in this stack.

---

## 2. Before you start

**Host**

- Linux with Docker Engine 24+ and the Compose plugin (Docker Desktop works too)
- 2 vCPU / 4 GB RAM is enough for a small deployment, and stays enough as calls
  get busier: media does not touch the host, so a screen share costs the server
  nothing at all. It costs the *participants* - see §4.
- Disk for the Postgres volume, and for the upload volume if you stay on local
  file storage

**Accounts and names**

- A domain on Cloudflare, and the hostname BetweenUs will answer on -
  `betweenus.example.com` throughout this document
- A Cloudflare Tunnel: either one you already run on the host, or a new one
  whose token you can paste into `.env`

**A decision to make now: whether to configure a TURN relay.** Nothing has to
be reachable on the host for media - it never goes there. But two clients still
have to find a path to each other, and a minority of network pairs cannot
without a relay. §4 is that decision, and it is the only media question this
deployment has.

**Building on the host or pulling images.** `docker compose ... up -d --build`
builds every image on the box, which needs a few GB of RAM. All nine images come
from one multi-stage `infrastructure/docker/Dockerfile` - see §17 for what that
buys and how to keep rebuilds short.
`.github/workflows/images.yml` builds and pushes one image per service to GHCR
on a `v*` tag, so a deployment can pin something built once - but nothing in
this repository deploys those images for you yet.

---

## 3. Step 1 - the code and the environment

```bash
git clone <your-fork> betweenus
cd betweenus
cp .env.example .env
```

Generate every secret. Never reuse the example values.

```bash
# JWT_SECRET, JWT_REFRESH_SECRET, SETTINGS_SECRET, POSTGRES_PASSWORD -
# run once per value.
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

### What must change from `.env.example`

| Variable | Production value | Why it matters |
| --- | --- | --- |
| `POSTGRES_PASSWORD` | generated | Postgres database password. If changed from `postgres`, `DATABASE_URL` password must match it |
| `DATABASE_URL` | `postgresql://postgres:<PASSWORD>@postgres:5432/betweenus?schema=public` | Must use the generated `POSTGRES_PASSWORD`. Inside Docker Compose, use `postgres:5432` container hostname |
| `JWT_SECRET` | generated | Signs access tokens. Changing it later signs everyone out |
| `JWT_REFRESH_SECRET` | generated | Signs refresh tokens. Must differ from `JWT_SECRET` |
| `SETTINGS_SECRET` | generated | Seals OAuth client secrets at rest. Falls back to `JWT_SECRET` when empty; changing either makes stored client secrets unreadable and they must be re-entered |
| `REFRESH_REPLAY_GRACE_MS` | `30000` | How long a just-rotated refresh token still answers with the pair that rotation produced, so a refresh interrupted by a reload or a dropped connection is not read as a stolen token and does not sign every device out. A replay inside the window creates no new session. `0` disables it and restores strict single-use |
| `PUBLIC_API_URL` | `https://betweenus.example.com` | The OAuth callback URL is built from it, and it must match what Google and GitHub have registered |
| `CORS_ORIGIN` | `https://betweenus.example.com` | Compose defaults it to `*`. The web client and the admin panel are both same-origin, so neither needs it; set this when browsers on *other* origins will call the API. Any origin named here may also be the destination of a finished OAuth sign-in |
| `STUN_URLS` | the default is fine | Where a peer asks what its own public address looks like, so it can offer one. Not a relay: no media passes through it and no port is opened for it. Defaults to two public servers from different operators, because this is the one step of ICE with no fallback. Point it at your own coturn if you would rather not talk to them |
| `CLOUDFLARE_TURN_KEY_ID` / `CLOUDFLARE_TURN_KEY_API_TOKEN` | empty, unless §4 says otherwise | A relay, for the pairs of networks that cannot form a direct path at all. Optional and off by default, so this deployment relays nothing unless you say so. Cloudflare dashboard → Realtime → TURN; call-service mints a short-lived credential per call and hands only that to a client, never the key |
| `GATEWAY_PORT` | `127.0.0.1:8080` with a host tunnel | Keeps the gateway off the LAN while a host-run `cloudflared` still reaches it |
| `CLOUDFLARE_TUNNEL_TOKEN` | token, or empty | Only for the container tunnel (`--profile public`). Leave empty when the tunnel already runs on the host |
| `LOG_LEVEL` | `info` | `debug` is noisy and logs more request detail than a public deployment wants |
| `STORAGE_DRIVER` and the `S3_*` block | see §13 | Empty means uploads live on a Docker volume |
| `BETWEENUS_DATA_PATH` | a path you choose, or empty | Where this deployment's data lives - `pnpm data:path /srv/x/betweenus` creates the tree and writes the four bind paths Compose mounts. Empty keeps everything in Docker named volumes, as before. See §18 |
| `BACKUP_INTERVAL_HOURS` / `BACKUP_KEEP` | `168` / `8` | Weekly dumps, eight kept. A dump also runs before every migration, and the migration will not start if it fails (§18) |

> [!IMPORTANT]
> **502 Bad Gateway / Upstream Connection Failures:** If `auth-service` fails to start because database migrations failed (due to a password or hostname mismatch in `DATABASE_URL`), Nginx will return a **502 Bad Gateway** when accessing `/admin` or signing in (`/api/v1/auth/login`). Ensure `DATABASE_URL` contains the exact same password as `POSTGRES_PASSWORD`.

`NODE_ENV=production` is set by the compose file; the value in `.env` only
affects host-run development.

> **Compose reads `.env` from the compose file's directory.** Because the file
> lives in `infrastructure/docker/`, pass the repo-root env file explicitly or
> substitution silently comes up empty:
>
> ```bash
> docker compose --env-file .env -f infrastructure/docker/docker-compose.yml <cmd>
> ```
>
> Required variables are declared `${VAR:?...}`, so a missing one fails the
> command with a named error rather than starting something half-configured.
> Every command below uses this form.

---

## 4. Step 2 - decide whether you need a TURN relay

This is the only media decision a deployment has, and it is smaller than it
used to be. There is no SFU to configure, no node address to get right, and no
port to open: media goes directly between the participants, so the host is not
in the path.

What two clients still need is a way to find each other.

**STUN, which you already have.** A machine behind NAT cannot describe itself -
it does not know what its public address looks like from outside - so it asks a
STUN server and offers the answer. No media passes through it, nothing has to be
opened for it, and one request per call is the whole of the traffic. defaults to two public servers and needs nothing from you. Point it at your own
coturn if you would rather not talk to them.

**TURN, which is optional and off.** Once both ends have described themselves,
most pairs of networks find a direct path. Some cannot:

| Both peers | Direct path |
| --- | --- |
| On the same LAN | Yes, immediately |
| On ordinary home or office NAT | Yes, once STUN has told them their addresses |
| One or both on symmetric NAT | No |
| One or both on mobile carrier-grade NAT | Usually not |

For those, a TURN server is a machine both ends reach *outbound* which forwards
between them. It opens no port on your host either - but it is a third party
carrying the media, and it costs bandwidth, so it is unconfigured by default.
Leave it that way and those particular calls fail rather than being quietly
relayed.

If you want them to work, create a key at **Cloudflare dashboard → Realtime →
TURN** and set:

```bash
CLOUDFLARE_TURN_KEY_ID="..."
CLOUDFLARE_TURN_KEY_API_TOKEN="..."
```

call-service mints a short-lived credential per call and hands only that to a
client; the key never leaves the server. Nothing about privacy changes: media
is DTLS-SRTP between the two peers, so a relay forwards packets it has no key
for.

**How to tell whether you need it.** You do not have to guess in advance -
signalling and everything else work regardless. If a call connects for people
on the same network and fails between two particular networks, that is this,
and it is one environment variable and a `docker compose up -d call-service`
away.

> [!TIP]
> **Zero Media Server / No LiveKit Infrastructure:**
> BetweenUs uses a direct peer-to-peer (P2P) WebRTC mesh for voice, video, and screen sharing. There is no SFU (such as LiveKit), no extra media port ranges to open on your firewall (`7881/tcp` or UDP ranges), and no external IP binding required on the host. If upgrading from an older deployment that had media ports open, you can safely close them.

---


## 5. Step 3 - bring the stack up

```bash
# Shortcut:
pnpm prod:up

# Direct compose command:
docker compose --env-file .env -f infrastructure/docker/docker-compose.yml up -d --build
```

What happens, in order:

1. **`postgres` and `redis`** start and become healthy. Neither publishes a port.
2. **`db-backup-once`** takes one dump, because the next step is the only one
   that can lose data irreversibly. If the dump fails, the migration does not
   run (§18).
3. **`migrate`** runs once - `prisma migrate deploy` against the database, using
   the auth-service image because it already carries the schema and the Prisma
   CLI. Nothing about it is auth-specific.
4. **Every service** waits for `migrate` to complete successfully, so no service
   ever serves traffic against an unmigrated schema.
5. **`db-backup`** starts the schedule: another dump every
   `BACKUP_INTERVAL_HOURS`.
6. **`web`** and **`admin-web`** each serve a static bundle: the app itself at
   `/`, and the panel under `/admin`.
7. **`nginx`** starts last and becomes healthy once `/health` answers.
8. **`cloudflared`** starts only with `--profile public`, and only after Nginx is
   *healthy* rather than merely present.

Check it:

```bash
docker compose --env-file .env -f infrastructure/docker/docker-compose.yml ps
curl -s http://localhost:8080/health
# {"status":"ok","service":"api-gateway"}
```

Migrations on a later upgrade are the same one-shot container; see §15.

---

## 6. Step 4 - create the first administrator

**The panel has no sign-up.** There is no route that turns a stranger into an
administrator, so the first one is created on a machine that already has
database access, and its generated password is printed once.

`GET /api/v1/admin/status` is deliberately unauthenticated and answers one
boolean: whether an administrator exists. That is what lets the panel tell
somebody who cannot log in yet to run the bootstrap.

### In the container stack

Postgres publishes no port, so run the bootstrap inside the project network,
reusing the `migrate` service's image and database credentials:

```bash
docker compose --env-file .env -f infrastructure/docker/docker-compose.yml \
  run --rm -w /repo/packages/database migrate \
  ./node_modules/.bin/tsx prisma/create-admin.ts
```

### On a host that can reach the database directly

With `DATABASE_URL` in the repo-root `.env` pointing at the database (the
development case, or a host with Postgres reachable):

```bash
pnpm admin:create
```

Both print the same block, once:

```
Admin account created.

  username  betweenusadmin
  password  <24 characters, shown once>

This password is shown once and cannot be recovered.
Sign in at the admin panel; it will ask you to choose a new one.
```

What the script does:

- Creates `betweenusadmin` / `admin@betweenus.local` with the `ADMIN` global role and
  `mustChangePassword` set, so the account cannot be used until its password is
  replaced.
- Generates 24 characters from an unambiguous alphabet - no `l`/`1`/`O`/`0` to
  misread off a terminal.
- **Is safe to re-run.** If the account exists it does nothing and says so.

### If the password is lost

```bash
# container stack
docker compose --env-file .env -f infrastructure/docker/docker-compose.yml \
  run --rm -w /repo/packages/database migrate \
  ./node_modules/.bin/tsx prisma/create-admin.ts --reset

# host
pnpm admin:create --reset
```

`--reset` issues a new password, re-arms the change-on-login flag, clears
`disabledAt`, and **revokes every live refresh token for that account** - so a
reset also ends whatever sessions the old password left behind.

---

## 7. Step 5 - the admin panel

Open `https://betweenus.example.com/admin`, sign in as `betweenusadmin`, and set a
real password when it asks. Until you do, the account can do nothing else.

The panel is a static bundle in its own container, proxied at `/admin`, talking
to the admin API on `/api/v1/admin` in the same origin. It offers:

- **Users** - search the directory, promote and demote administrators, disable
  and re-enable accounts, delete accounts.
- **OAuth providers** - configure Google and GitHub (§8).
- **Your own account** - password, username, display name.

The guard rails are enforced in `auth-service`, not in the panel:

- The last administrator cannot be removed, demoted or disabled.
- No self-demotion and no self-deletion.
- Disabling an account revokes its live sessions immediately.

Ordinary users register through the desktop client as normal; the administrator
account exists to run the deployment, not to be somebody's chat account.

Rate limiting on this surface is tight on purpose: `/api/v1/admin` and
`/api/v1/auth/` share the gateway's 5 r/s bucket per address, because both are
credentialed.

---

## 8. Step 6 - OAuth sign-in

Optional. Google and GitHub are supported, and their buttons appear in clients
only once a provider is configured.

1. In the panel, open the provider. It shows the exact **callback URL**, built
   from `PUBLIC_API_URL`. If `PUBLIC_API_URL` is wrong, the callback is wrong
   and the provider rejects the exchange.
2. Register that callback with Google or GitHub, and paste the client id and
   client secret back into the panel.
3. The secret is sealed with `SETTINGS_SECRET` before it is stored and is never
   returned by the API - not to the panel, not to anyone.

The code exchange happens server-side, and the finished sign-in hands back a
one-time code to a loopback redirect for the desktop client. Where else it may
be sent is derived rather than configured: `PUBLIC_API_URL`'s origin - which is
this site, where the web client and the admin panel are both served - plus any
origin in `CORS_ORIGIN`, plus loopback. There is nothing to set for provider
sign-in in a browser on this deployment, and nothing to set for the desktop
client either.

A `CORS_ORIGIN` of `*` grants nothing here. "Any site may call the API" is not
"any site may be handed a session code", and the wildcard is skipped.

If you later change `SETTINGS_SECRET` (or `JWT_SECRET` while `SETTINGS_SECRET`
is empty), stored client secrets become unreadable and must be re-entered.

---

## 9. Step 7 - public ingress with Cloudflare Tunnel

The tunnel is how BetweenUs is reachable without opening an inbound port.
`cloudflared` makes an outbound connection to Cloudflare, Cloudflare terminates
TLS, and the origin has no listening socket exposed to the internet. Nginx
behind it speaks plain HTTP on 8080 and trusts the `X-Forwarded-*` headers the
tunnel sets.

### Either: a tunnel already running on the host

The common case, and the cheaper one - one tunnel for the whole server. Add one
ingress entry to the config you already have:

```yaml
ingress:
  - hostname: betweenus.example.com
    service: http://localhost:8080      # GATEWAY_PORT
  # ...your other hostnames...
  - service: http_status:404
```

Reload it (`systemctl reload cloudflared`). Keep `GATEWAY_PORT=127.0.0.1:8080`
so the gateway is reachable by the tunnel and by nothing else on the network.

### Or: the tunnel as a container

```bash
CLOUDFLARE_TUNNEL_TOKEN=... docker compose --env-file .env \
  -f infrastructure/docker/docker-compose.yml --profile public up -d
```

Token mode carries its ingress rules in the Cloudflare dashboard rather than in
this repository, and the container reaches Nginx as `http://nginx:8080` on the
internal network - so the host port does not have to be published at all.

`infrastructure/cloudflare/tunnel.yml` documents both, including a
config-file-mode variant.

### Cloudflare settings that matter

- **WebSockets must be enabled** for the zone. `/ws/chat`, `/ws/presence`,
  `/ws/remote`, `/ws/call` and `/ws/chat` are all long-lived upgrades; without it
  realtime dies while plain REST keeps working, which is a confusing failure.
- **Body size.** Nginx caps `/api/v1/uploads` at 32 MB per request, and an
  attachment larger than 8 MB is uploaded in parts, so no single request
  approaches Cloudflare's proxy limit. That is why a 100 MB attachment works on
  a plan with a 100 MB request cap.
- **Do not add a second TLS hop.** The tunnel is the encrypted hop; Nginx has no
  certificate of its own in this stack.

---

## 10. Which endpoints the tunnel must carry, and why

One hostname carries everything, and that is a design property, not a
convenience: the desktop client is configured with a single address
(`VITE_API_URL`), so any path missing from ingress is a feature that fails at
runtime with no second address to fall back to.

The tunnel points at the gateway, so it carries the whole path table by
implication. It is worth knowing what those paths are, because the failure of
any one of them looks like a bug in the app rather than a hole in ingress.

| Path | Upstream | Why it has to be public | What breaks without it |
| --- | --- | --- | --- |
| `/api/v1/auth/` | auth-service | Register, login, refresh-token rotation | Nobody can sign in, and signed-in clients die when the access token expires |
| `/api/v1/admin` | auth-service | Admin API, plus the unauthenticated `status` bootstrap check | The panel cannot load or tell you to bootstrap |
| `/admin` | admin-web | The panel's static bundle | No panel |
| `/` | web | The web client's static bundle - everything not claimed by a route above is one of its pages | No browser client; the desktop app is unaffected |
| `/api/v1/servers`, `/api/v1/channels` | server-service | Servers, members, roles, overrides, channels, invites | The client signs in to an empty shell |
| `/api/v1/messages` | chat-service | History paging and sending | Reads and sends fail; the socket alone cannot backfill |
| `/api/v1/friends`, `/api/v1/users`, `/api/v1/dm` | chat-service | User search, friendships, direct-message channels (user-service is still a scaffold) | No DMs, no friend list, no user search |
| `/api/v1/e2ee` | chat-service | The key directory: device public keys and wrapped channel keys | A new device cannot obtain channel keys, so history stays permanently unreadable to it |
| `/api/v1/uploads` | chat-service | Encrypted attachment upload and download, including multipart | Attachments and avatars fail; body cap here is 32 MB, wider than the rest |
| `/api/v1/calls` | call-service | Hands out ICE servers for a call, after checking the caller may start one | Clients cannot learn how to reach each other, so no call connects |
| `/api/v1/notifications` | notification-service | Mutes, quiet hours, read markers | Unread state and per-channel mutes stop persisting |
| `/api/v1/remote` | remote-gateway | Machine registry, grants, audit | Remote machines cannot enrol or be listed |
| `/ws/chat` | chat-service | Realtime message fanout, upgraded | Messages appear only on reload |
| `/ws/presence` | presence-service | Status, typing, voice rosters | Everyone looks offline; nobody appears in a voice channel |
| `/ws/remote` | remote-gateway | The relay between a controller and an agent, permission-checked per event | Remote sessions cannot start, and enrolled agents cannot dial in |
| `/ws/call` | call-service | Call signalling: the roster of who is in a call, and the offers, answers and ICE candidates between two peers | Voice, video and screen share never connect - clients hang at "connecting" |
| `/health` | nginx | Gateway liveness; the tunnel container waits on it | Nothing user-facing, but the container tunnel will not start |

Three of these are worth reading twice:

- **`/ws/call` is signalling only.** Proxying it is cheap precisely because no
  media passes through it - that is why one hostname covers voice at all, and
  why a tunnel that carries no UDP is nonetheless enough.
- **The WebSocket paths need upgrade to survive the whole chain.** Nginx sets
  `proxy_read_timeout 3600s` so the gateway does not cut an idle socket; a proxy
  in front that strips `Upgrade`, or a 60-second idle timeout, produces sockets
  that reconnect every minute and a client that looks flaky.
- **`/api/v1/e2ee` carries no plaintext keys.** Public keys and sealed blobs
  only. It is on the tunnel because a client cannot decrypt anything without
  it, not because it is a weaker surface.

Nothing else needs to be public. Postgres, Redis and every service port are on
private Docker networks; `remote-gateway` is deliberately kept off
`api-network` and reaches Postgres and nothing more.

---

## 11. What does not go through the tunnel

**WebRTC media**, and this is now a statement about the design rather than a
gap in it.

A Cloudflare Tunnel carries HTTP and WebSocket. WebRTC media is UDP, and no
tunnel carries that. The old architecture ran an SFU, so media had to get past
the tunnel somehow, and this section used to list the ways: publish `7881/tcp`
and a UDP range on the host's public address, advertise an address the SFU
could be reached at, or force everything through a relay. Each was a thing to
get wrong, and getting it wrong looked the same from the outside - a call that
connected and then went quiet.

Media is peer to peer now, so it never approaches the tunnel:

- **Signalling** - the roster, offers, answers and ICE candidates - crosses the
  tunnel on `/ws/call` and `/ws/remote`, exactly as chat does on `/ws/chat`.
- **Media** goes directly from one client to the other. It does not reach this
  host, so nothing here needs to be reachable for it.

What replaces the old requirement is smaller and belongs to the clients, not to
you: two peers have to find a path to each other. STUN handles most pairs and
needs nothing from your host; the rest need a TURN relay, which both peers also
reach outbound. See §4 - it is one optional environment variable, and it opens
no port here either.

Chat, files, presence, notifications and remote authorisation were always
complete over the tunnel on their own. Now so are calls.

**Nothing connects towards a remote machine, ever.** An agent enrols under the
account signed in on it, keeps its credential in the OS keychain, and dials out
to `/ws/remote`. No port is opened on the controlled machine, and `3389` is
published nowhere in this stack.

---

## 12. Step 8 - the desktop client

A deployment is one URL, and the client needs exactly one variable:

```
VITE_API_URL="https://betweenus.example.com"
```

It is read from the repo-root `.env` at **build** time, so it is baked into a
packaged app:

```bash
pnpm install
pnpm build
pnpm --filter @betweenus/desktop package     # electron-builder
```

It is only a default. **Connect to a self-hosted instance** on the login screen,
and *Change server* in Settings → My Account, point a window at any other
deployment: the address is normalised and probed before it is stored, and
connecting elsewhere signs the window out and reloads. A build can therefore
ship pointed at one deployment without being locked to it, which is what lets
you distribute a client without rebuilding per server.

`VITE_API_URL` is only what a *packaged* client falls back to: a renderer
loading from `file://` has no origin to read. Anything served over http(s) -
the web client, the admin panel, either dev server - was served by a gateway
and talks to that origin, so neither of the browser bundles needs the variable
set at all.

---

## 13. File storage

`@betweenus/storage` picks a driver from the environment:

- **All `S3_*` empty (default).** Uploads land in `LOCAL_STORAGE_PATH`, which
  compose maps to the `upload-data` volume at `/data/uploads`, and chat-service
  serves them from `/api/v1/uploads`. Nothing to configure; back the volume up -
  or give the deployment a data path (§18) and back up a directory instead.
- **`S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` all set.** The
  S3 driver takes over. Partial configuration stays on local disk rather than
  half-working.
- **`STORAGE_DRIVER=local|s3`** forces one. Forcing `s3` without credentials
  fails at boot instead of silently falling back.

Files are encrypted in the renderer before upload, so the bucket holds
ciphertext and the server cannot type what it stores - it serves everything as
`application/octet-stream` with a download disposition. Keys are UUID-based, so
a client filename never decides where a file lands.

Size caps, all enforced server-side:

| Variable | Default | Applies to |
| --- | --- | --- |
| `MAX_UPLOAD_BYTES` | 25 MB | One request body - a whole small file, or one part of a large one |
| `MAX_ATTACHMENT_BYTES` | 100 MB | The assembled attachment, however many parts it took |
| `MAX_PICTURE_BYTES` | 8 MB | An avatar or server icon |

Nginx caps the upload route at 32 MB per request, which is headroom over
`MAX_UPLOAD_BYTES` for multipart framing. Raising `MAX_UPLOAD_BYTES` past 32 MB
does nothing until the gateway cap moves too.

---

## 14. Verifying the deployment

Work outwards, so a failure names its own layer.

```bash
# 1. Gateway is up on the host
curl -s http://localhost:8080/health

# 2. Gateway is up through the tunnel
curl -s https://betweenus.example.com/health

# 3. The admin API answers, and says an administrator exists
curl -s https://betweenus.example.com/api/v1/admin/status

# 4. Nothing crashed on boot
docker compose --env-file .env -f infrastructure/docker/docker-compose.yml \
  logs --tail=50 auth-service chat-service call-service
```

Then, in a client pointed at the hostname:

1. Register an ordinary account, and sign in.
2. Create a server and a channel - exercises server-service and Postgres.
3. Send a message, with a second client open - exercises chat-service, Redis
   fanout and `/ws/chat`. If the message appears only after a reload, the
   WebSocket path is not upgrading.
4. Watch presence and typing - `/ws/presence`.
5. Upload an attachment - `/api/v1/uploads` and the storage driver.
6. Join a voice channel from two clients, ideally on **different networks** -
   two clients on one LAN prove the least interesting case. Connecting but
   silent means signalling worked and the two peers could not find a path to
   each other: that is the TURN question in §4.
7. Sign in to `/admin` and load the user directory.

### Troubleshooting 502 Bad Gateway Errors

If Cloudflare or Nginx returns a **502 Bad Gateway** when navigating to `https://betweenus.example.com/admin/` or making requests to `/api/v1/auth/login`:

1. **Check Database URL & Password Alignment**:
   Ensure `DATABASE_URL` in `.env` contains the exact same password as `POSTGRES_PASSWORD`.
   - **Correct Docker Compose Format**:
     `DATABASE_URL="postgresql://postgres:<YOUR_POSTGRES_PASSWORD>@postgres:5432/betweenus?schema=public"`
   - If the passwords mismatch or `localhost` is used instead of `postgres` container hostname in `DATABASE_URL`, database migrations (`migrate` container) will fail, causing `auth-service` to not start.

2. **Check Service Container Status**:
   ```bash
   docker compose --env-file .env -f infrastructure/docker/docker-compose.yml ps
   ```
   Verify `migrate` exited with `0` and `auth-service` is running (`Up`).

3. **Check Service Logs**:
   ```bash
   docker compose --env-file .env -f infrastructure/docker/docker-compose.yml logs migrate auth-service nginx admin-web
   ```

4. **Verify Cloudflare Ingress**:
   Ensure host `cloudflared` points to `http://127.0.0.1:8080` (or container tunnel profile is running).

---

## 15. Day two - backups, upgrades, logs

**Backups.** Two places hold everything that cannot be rebuilt: the database and
the uploads. Both are backed up for you - the database on a schedule and before
every migration, the uploads by copying the directory §18 puts them in.

The stack runs `db-backup` from the moment it comes up: one dump now, then one
every `BACKUP_INTERVAL_HOURS` - weekly by default - keeping the newest
`BACKUP_KEEP`. §18 is the whole of it, including where the dumps land and how to
restore one. On demand:

```bash
pnpm db:backup
```

The uploads are not dumped by anything; they are a directory. Point
`BETWEENUS_DATA_PATH` at somewhere your host backup already covers, or copy
`<root>/data/media` on the same schedule as everything else.

Understand what a backup restores. Messages and attachments are stored as
ciphertext, and the keys that open them live on users' devices, sealed with the
OS keychain. A restored database gives users their history back **only because
their devices still hold their keys**. A user who loses every device loses that
history, and no server-side backup changes that. This is the intended property,
and `development/E2EE.md` states its limits plainly.

**Upgrades.**

```bash
git pull
docker compose --env-file .env -f infrastructure/docker/docker-compose.yml \
  up -d --build
```

The `migrate` one-shot runs again before any service takes traffic, so schema
changes apply in the right order - and `db-backup-once` runs before *it*, so the
dump you would have wanted exists whether or not you remembered to take one. If
that dump fails the migration does not start. There is still no automated
rollback: recovery is restoring the dump (§18).

**Logs.** Every service logs structured JSON with a request id, and the id
survives a hop between services - the gateway emits the same shape, so gateway
lines and service lines join in one pipeline. Passwords, tokens, keys and
message content are never logged.

```bash
docker compose --env-file .env -f infrastructure/docker/docker-compose.yml \
  logs -f --tail=100
```

**Rotating secrets.** `JWT_SECRET` and `JWT_REFRESH_SECRET` can be replaced;
doing so invalidates every issued token and signs everyone out. `SETTINGS_SECRET`
cannot be rotated without re-entering OAuth client secrets. There is no secret
manager and no rotation tooling here - secrets are environment variables read
from `.env`, and that is a known gap.

**Scaling.** Services are stateless; Redis carries presence, fanout and
rate-limit windows, so more than one instance of chat-service stays in step by
design. `limit_req` at the gateway is per Nginx instance, and the Redis-backed
limiter inside each service is the one that holds across instances.

---

## 16. Known gaps

Stated plainly, because a deployment guide that implies completeness is worse
than useless. All of these are tracked in `development/TODO.md`.

- **No TURN server is configured by default**, and some networks need one.
  Media is peer to peer, so nothing has to be reachable on this host - but two
  peers behind symmetric or carrier-grade NAT cannot form a direct path at all,
  and for them voice, screen share and remote desktop do not connect while
  everything else does. §4 is one environment variable away from fixing it; it
  is off by default because a relay is a third party in the media path and that
  is the operator's call, not this repository's.
- **A remote-desktop session's fingerprints are unverified.** The screen is
  end-to-end encrypted between the two machines, but unlike a call there is no
  shared key to bind the DTLS fingerprint with, so a malicious `remote-gateway`
  could stand in the middle. See "Known limits" in `development/E2EE.md`.
- **Calls are a full mesh**, so each participant uploads one copy of their media
  per other participant. Comfortable to about five on video and eight on voice;
  past that a call degrades for everyone at once, and `call-service` refuses a
  ninth peer rather than letting it.
- **Backups never leave the host.** The dumps §18 takes sit next to the database
  they came from, which covers a bad migration and not a dead disk. Copying
  `<root>/backup` somewhere else is the operator's own job.
- **Secrets are `.env` files.** No Docker secrets, no external manager, no
  rotation.
- **Nothing deploys.** Images are built and pushed by CI on a tag; putting them
  on a machine is manual.
- **No TLS between Cloudflare and Nginx.** The tunnel is the encrypted hop, and
  there is no supported way to give Nginx a certificate of its own here.
- **`remote-agent` and `user-service` are scaffolds.** On a desktop the agent is
  the app itself; user routes are served by chat-service.
- **No version negotiation.** Nothing checks that a client's version matches the
  deployment's; a client too old finds out through a failing request.
- **Remote input injection is Windows-only.** Elsewhere a session can watch but
  not touch.

---

## 17. How the images are built, and why rebuilds are quick

Every image - the seven Node services, the `migrate` one-shot that reuses the
auth-service image, and the static admin panel - is a target in a single
`infrastructure/docker/Dockerfile`:

```bash
docker build -f infrastructure/docker/Dockerfile --target chat-service .
```

The build context is always the repo root, because a service needs the
workspace, the lockfile and `packages/`, not just its own directory.

The file is one Dockerfile rather than nine because the stages are shared:

- **`deps`** copies only `package.json` files, the lockfile and the Prisma
  schema, then runs `pnpm install`. Editing TypeScript does not invalidate it,
  so the slowest step in the build usually does not run at all.
- **`build`** copies the source and runs `pnpm build` once for the whole
  workspace. Nine per-service builds each recompiled the same shared packages.
- The seven service images are the same runtime stage with a different working
  directory, so the large `COPY --from=build` produces one layer that all of
  them reference instead of nine near-identical ones.

Two BuildKit cache mounts carry state between builds: the pnpm store, so a
lockfile change re-links rather than re-downloads, and the Turborepo cache, so
only the packages you actually touched recompile. They are per-machine and are
cleared by `docker builder prune`.

Things that make a rebuild slow again:

- **Editing a `package.json` or the lockfile** re-runs the install. Expected.
- **A large build context.** `.dockerignore` keeps `node_modules`, most of
  `apps/desktop` - its UI source is re-included, because the web client mounts
  it - `.git` and the docs out. Anything big you add at the repo root should go in it
  too, or it is uploaded to the daemon on every single build.
- **`docker builder prune` / a Docker Desktop reset**, which discards the cache
  mounts and the layer cache alike. The first build after that is a cold one.

The `# syntax=docker/dockerfile:1.7-labs` line at the top of the Dockerfile is
required: it pulls the BuildKit frontend providing `COPY --parents`, which is
what lets the dependency stage take the workspace manifests without the source
behind them. BuildKit fetches it once and caches it, but the first build on a
machine with no network access to Docker Hub will fail on that line.

---

## 18. One data path, and automatic backups

By default every persistent thing lives in a Docker named volume, which is fine
until you want to know where it is, put it on a particular disk, or include it
in the backup the host already runs. Say where the data lives once instead:

```bash
pnpm data:path /srv/sd2345/docker/betweenus
```

That creates the tree, hands the uploads directory to the uid the services run
as, and writes the paths into `.env`:

```text
/srv/sd2345/docker/betweenus/
├── data/
│   ├── postgres/          the database cluster
│   ├── redis/             Redis' own AOF/RDB
│   └── media/             uploads
│       ├── pictures/      avatars and server icons
│       └── attachments/   message attachments
└── backup/                betweenus-YYYYMMDD-HHMMSS.sql.gz
```

Then bring the stack up as usual (`pnpm prod:up`). Re-running the script is
safe; it creates what is missing and rewrites the same four values.

**Why the tree has these names and not `image/` and `video/`.** `pictures/` and
`attachments/` are the prefixes chat-service actually writes, and an attachment
arrives *already encrypted* from the renderer - the server stores an opaque blob
and serves it as `application/octet-stream`. Splitting attachments by media type
would mean either trusting a filename the client chose or decrypting them
server-side, and the second is the property the whole design exists to keep.
Pictures are the exception because they are not encrypted, which is why they get
a directory of their own.

**What Compose actually reads.** Not `BETWEENUS_DATA_PATH` - Compose cannot branch
on whether a variable is set, so each mount interpolates one variable that falls
back to the named volume it always used:

| Variable | Mount | Default |
| --- | --- | --- |
| `POSTGRES_DATA_PATH` | `/var/lib/postgresql/data` | `postgres-data` volume |
| `REDIS_DATA_PATH` | `/data` | `redis-data` volume |
| `UPLOAD_DATA_PATH` | `/data/uploads` | `upload-data` volume |
| `BACKUP_DATA_PATH` | `/backups` | `backup-data` volume |

A deployment that never runs the script therefore behaves exactly as before, and
one that does can still override a single path by hand - keep the database on the
fast disk and the backups on the big one.

`BETWEENUS_DATA_PATH` is recorded in `.env` only so the script can be re-run with
no argument.

**Permissions, the one thing that bites.** A named volume is seeded from the
image, so it inherits the ownership the image ships. A **bind mount never is**:
Docker creates it root-owned, and the services run as uid 1000. Postgres and
Redis chown their own directory on start; the Node services do not, so the
script chowns `data/media` (and both subdirectories) to `1000:1000` and ensures `backup/` is writable by container users. Run it as
root, or do it yourself afterwards:

```bash
sudo chown -R 1000:1000 /srv/sd2345/docker/betweenus/data/media
sudo chmod 777 /srv/sd2345/docker/betweenus/backup
```

Get this wrong and uploads fail with `EACCES` or database pre-migration dumps fail with permission errors while the rest of the service works.

**Moving a running deployment onto a path.** The volumes are not migrated for
you. With the stack down, copy the contents out of each volume and into the
matching directory:

```bash
docker compose --env-file .env -f infrastructure/docker/docker-compose.yml down
docker run --rm -v betweenus_postgres-data:/from -v /srv/sd2345/docker/betweenus/data/postgres:/to \
  alpine sh -c 'cp -a /from/. /to/'
# ...the same for betweenus_redis-data -> data/redis and betweenus_upload-data -> data/media
pnpm data:path /srv/sd2345/docker/betweenus     # chowns media, writes .env
pnpm prod:up
```

Take a dump first (`pnpm db:backup`), and keep the old volumes until the stack
has come back up healthy. Copying *into* a live Postgres data directory
corrupts it; the stack has to be down.

### The backups

Two containers, one script (`infrastructure/docker/backup.sh`), both running
`pg_dump` from the postgres image so the client version always matches the
server's:

- **`db-backup`** - dumps once at start, then every `BACKUP_INTERVAL_HOURS`, and
  deletes everything past the newest `BACKUP_KEEP`. Weekly and eight by default,
  which is two months of history for a few megabytes.
- **`db-backup-once`** - one dump, immediately before `prisma migrate deploy`.
  `migrate` waits for it to *succeed*, so a schema change on a deployed database
  cannot go first. `BACKUP_ON_MIGRATE=0` turns that off, which is a decision
  rather than a default.

| Variable | Default | Meaning |
| --- | --- | --- |
| `BACKUP_INTERVAL_HOURS` | `168` | Hours between scheduled dumps. `24` nightly, `1` hourly |
| `BACKUP_KEEP` | `8` | Dumps retained. The oldest beyond this are deleted after each dump |
| `BACKUP_ON_MIGRATE` | `1` | Dump before migrating, and refuse to migrate if it fails |
| `BACKUP_DATA_PATH` | `backup-data` | Where the dumps land |

A change to any of them takes effect on
`docker compose ... up -d db-backup`.

Dumps are gzipped plain SQL named `betweenus-YYYYMMDD-HHMMSS.sql.gz`, written under
a `.partial` name and renamed only when `pg_dump` finished - so a dump
interrupted halfway is never mistaken for a backup, by the retention sweep or by
you. Plain SQL rather than a custom-format archive because restoring it needs
nothing but `psql`, and the moment you need a restore is the wrong moment to
discover a version mismatch in `pg_restore`.

**Restoring one.** Into an empty database, with the services stopped so nothing
writes underneath it:

```bash
C=infrastructure/docker/docker-compose.yml
docker compose --env-file .env -f $C stop auth-service server-service chat-service \
  presence-service notification-service call-service remote-gateway

# Fresh database, then the dump. Adjust the filename.
docker compose --env-file .env -f $C exec -T postgres \
  psql -U postgres -c 'DROP DATABASE betweenus WITH (FORCE);' -c 'CREATE DATABASE betweenus;'
gunzip -c /srv/sd2345/docker/betweenus/backup/betweenus-20260818-030000.sql.gz \
  | docker compose --env-file .env -f $C exec -T postgres psql -U postgres -d betweenus

docker compose --env-file .env -f $C up -d
```

> [!WARNING]
> `DROP DATABASE ... WITH (FORCE)` destroys the current database. It is the
> right thing when the dump is what you want back, and the wrong thing by
> accident: take a dump of the *current* state first (`pnpm db:backup`) so a
> mistaken restore is itself recoverable.

The stack comes back up with `migrate` running against the restored schema, so a
dump older than the code is brought forward rather than refused.

**What a restored dump gives back, and what it does not.** Messages and
attachments are ciphertext, and the keys live on users' devices. A restore
returns everybody's history **because their devices still hold their keys** - a
user who has lost every device does not get history back, and no server-side
backup changes that. `development/E2EE.md` states the limits plainly. The dumps
are also worth protecting for the opposite reason: they contain password hashes,
sealed identity backups and every OAuth client secret, so they belong somewhere
with the same access as the database itself.
