# BetweenUs

Initial monorepo scaffold for a Discord-like communication platform with secure remote desktop access.

# BetweenUs Architecture

## 1. Project Overview

Build a Discord-like communication and remote-access platform.

Core capabilities:

- User authentication
- Servers
- Text channels
- Direct messages
- Voice calls
- Video calls
- Screen sharing
- Live streaming (deferred - see "Live streaming" in section 4)
- Presence / online status
- Notifications
- Roles and permissions
- Remote desktop access
- Remote machine assignment
- Remote control
- Clipboard
- File transfer
- Future web client
- Future Android client

Desktop is primary client for initial release.

Architecture must support Web and Android clients later without major backend changes.

---

# 2. Technology Stack

## Desktop

- Electron
- React
- TypeScript
- Tailwind CSS
- Zustand
- WebSocket
- WebRTC (`RTCPeerConnection`, no media SDK)

Desktop responsibilities:

- Chat UI
- Voice/video UI
- Screen sharing
- Peer connections: it is the client that carries media
- Notifications
- System integration
- Remote desktop client
- Remote machine management

---

## Backend

- Node.js
- TypeScript
- NestJS

Backend uses microservices.

Each service must be independently deployable.

Each service must have:

- Own `package.json`
- Own `Dockerfile`
- Own source directory
- Clear API boundary
- Clear responsibility

---

# 3. Microservices

## API Gateway

Technology:

- Nginx or Traefik

Responsibilities:

- Request routing
- WebSocket routing
- Rate limiting
- Load balancing
- Request size limits
- Internal service routing

API Gateway does NOT contain business logic.

---

## Auth Service

Responsibilities:

- Registration
- Login
- Logout
- JWT access tokens
- Refresh tokens
- OAuth
- Session management
- Password management
- Account verification

---

## User Service

Responsibilities:

- User profiles
- Avatars
- User settings
- User devices
- Friend relationships
- User status

---

## Server Service

Responsibilities:

- Servers
- Server members
- Roles
- Permissions
- Channel management
- Invitations
- Server settings

---

## Chat Service

Responsibilities:

- Text channels
- Direct messages
- Messages
- Message editing
- Message deletion
- Replies
- Reactions
- Attachments
- Message history

Use WebSocket for realtime communication.

---

## Presence Service

Responsibilities:

- Online status
- Offline status
- Idle status
- Typing indicators
- Activity status
- User presence

Use Redis for realtime presence state.

---

## Notification Service

Responsibilities:

- Desktop notifications
- Push notifications
- Mentions
- Message notifications
- Call notifications
- Remote-access notifications

---

## Call Service

Responsibilities:

- Call signalling (`/ws/call`)
- Who may join which call
- The roster of peers in a call
- Relaying offers, answers and ICE candidates between two peers
- ICE server configuration (STUN, and TURN when configured)
- Call lifecycle
- Voice/video session metadata

Call Service never sees media. It is a switchboard: it introduces two clients to
each other and then has nothing further to do with the call.

Do NOT implement an SFU. Do NOT run one.

---

# 4. Peer-to-Peer Media Architecture

Media is peer to peer. There is no media server.

Every participant holds one `RTCPeerConnection` per other participant - a full
mesh - and voice, video and screen share travel directly between the two
machines over DTLS-SRTP.

Architecture:

Desktop A                          Desktop B
    |                                  |
    |  1. signalling (WebSocket)       |
    +-----> Call Service /ws/call <----+
    |                                  |
    |  2. media (WebRTC, direct)       |
    +<--------------------------------->
           voice / video / screen share

Call Service handles:

- Authentication
- Permission to join a call
- The peer roster
- Relaying SDP and ICE between peers
- Handing out ICE servers

Call Service does NOT handle:

- Media of any kind
- Encoding, transcoding, mixing or recording
- Anything that would make it a hop in the media path

## What a mesh costs

Each participant uploads one copy of its media per other participant. Uplink
grows linearly with the call, so the mesh is right for small calls and wrong for
large ones:

| Participants | Video | Voice only |
| --- | --- | --- |
| 2-5 | Comfortable | Comfortable |
| 6-8 | Degrades; expect to drop video | Comfortable |
| 9+ | Not supported | Marginal |

This is the accepted ceiling, not an oversight. A call that needs to be bigger
than this needs an SFU, and adding one is a deliberate future decision - not
something to smuggle back in.

## NAT traversal

- **STUN is required.** A peer needs to learn its own public address before it
  can offer one. It is not a relay: nothing but the address discovery goes
  through it, and no port has to be opened for it.
- **TURN is optional and off by default.** Some pairs of networks - symmetric
  NAT, mobile carrier-grade NAT - cannot form a direct path at all. TURN is the
  relay that fixes those, and configuring one is the operator's choice. With
  none configured, those calls fail rather than being relayed, which is the
  intended default.
- **No port forwarding, ever.** Both peers dial out. Nothing listens for an
  inbound connection.

## Live streaming

One-to-many streaming is out of scope while media is peer to peer: a broadcast
to 50 viewers is 50 uplinks from the streamer. It comes back when, and only
when, there is a media server to carry it.

---

# 5. Remote Desktop Architecture

Remote desktop must be separate from normal chat services.

Components:

- Remote Gateway
- Remote Agent
- Desktop Remote Client

Architecture:

Desktop App                               Remote Agent
    |                                          |
    |  1. session + input (TLS / WebSocket)    |
    +--------> Remote Gateway <----------------+
    |          (relays signalling and input,   |
    |           enforces permissions, audits)  |
    |                                          |
    |  2. screen (WebRTC, direct)              |
    +<---------------------------------------->+
                                               |
                                               v
                                       Target Machine

Remote Gateway relays control: the session handshake, the offer/answer/ICE that
set up the peer connection, mouse and keyboard events, clipboard, and the audit
trail. It does not carry the screen.

The screen is peer to peer, for the same reason a call is: it is the only shape
that survives a Cloudflare Tunnel without opening a port. Both the agent and
the controller dial out to the gateway over WebSocket, and the picture then
goes directly between them.

Remote Agent runs on machine being controlled.

Remote Agent responsibilities:

- Screen capture
- Mouse input
- Keyboard input
- Clipboard
- File transfer
- Audio
- Connection state
- Device registration

Never expose RDP port directly to internet.

Do NOT require public inbound port `3389`.

Remote Agent should establish outbound secure connection.

---

# 6. Remote Permissions

Remote access must use explicit permissions.

Supported permissions:

- `REMOTE_VIEW`
- `REMOTE_CONTROL`
- `REMOTE_FILE_TRANSFER`
- `REMOTE_CLIPBOARD`
- `REMOTE_AUDIO`
- `REMOTE_ADMIN`

Permissions must be assignable per user and per remote machine.

Support temporary permissions.

Example:

User A
    |
    +-- REMOTE_VIEW
    +-- REMOTE_CONTROL
    |
    v
PC-123

Temporary access should support expiration.

---

# 7. Cloudflare Tunnel

Use Cloudflare Tunnel for public access.

Do NOT expose backend servers directly to internet.

Architecture:

Internet
    |
    v
Cloudflare
    |
    v
Cloudflare Tunnel          (HTTP + WebSocket only)
    |
    v
Nginx / Traefik
    |
    +-- API Services
    +-- WebSocket  (/ws/chat, /ws/presence, /ws/call, /ws/remote)
    +-- Remote Gateway

`cloudflared` can run as Docker container.

## The tunnel carries signalling, never media

This is the rule the whole media design is built around.

A Cloudflare Tunnel carries HTTP and WebSocket. It does NOT carry UDP, and
WebRTC media is UDP. Any design that puts a media server behind the tunnel has
to smuggle media around it - a second public address, an open UDP port, a
forced relay - and every one of those is a thing that breaks.

Peer-to-peer media does not have this problem, because media never goes near
the tunnel:

```text
Signalling:  Client ---> Cloudflare ---> Tunnel ---> Nginx ---> call-service
                         (WebSocket, works exactly as chat does)

Media:       Client <=========================================> Client
                         (WebRTC, direct, never touches Cloudflare)
```

Consequences, all of them good:

- No UDP port is opened anywhere.
- No service advertises an address only it can reach. There is no
  advertised-address setting, and there must never be one. This is the single
  most expensive class of bug the old design had: an address that is correct on
  the server and wrong for every client, which survives every test the operator
  can run locally.
- The deployment is one hostname. Signalling is a WebSocket path on the same
  gateway everything else uses.
- A client on any network reaches signalling if it can reach the site at all.

## Reaching the other peer

The tunnel gets both clients *talking*. It does not get their media across;
that is ICE's job.

| Case | What carries the media |
| --- | --- |
| Same LAN | Direct, host candidates |
| Different networks, ordinary NAT | Direct, STUN-discovered addresses |
| Symmetric or carrier-grade NAT | TURN relay, when one is configured |

STUN needs no tunnel and no port: the client dials out to a public STUN server
itself.

TURN is optional and unconfigured by default. When a deployment wants the last
category of network to work, Cloudflare's own TURN service is the natural fit -
it is outbound-only from both peers, so it opens no ports either, and
`call-service` mints short-lived credentials for it per call. It is a relay, so
it is off unless an operator turns it on.

Cloudflare Tunnel and internal API Gateway have different responsibilities.

Cloudflare Tunnel:

- Secure outbound tunnel
- Public ingress for HTTP and WebSocket
- No port forwarding
- No direct public server exposure

Nginx / Traefik:

- Internal routing
- Load balancing
- WebSocket routing
- Rate limiting
- Service routing

---

# 8. Docker

All backend services must be containerized.

Expected services:

- `cloudflared`
- `nginx` or `traefik`
- `auth-service`
- `user-service`
- `server-service`
- `chat-service`
- `presence-service`
- `notification-service`
- `call-service`
- `remote-gateway`
- `remote-agent`
- `postgres`
- `redis`

There is no media container. Adding one is how the tunnel problem comes back.

Use Docker Compose for development.

Production can later move to Kubernetes.

---

# 9. Database

Primary database:

- PostgreSQL

ORM:

- Prisma

PostgreSQL stores persistent application data.

Examples:

- Users
- Servers
- Members
- Roles
- Permissions
- Channels
- Messages
- Devices
- Remote machines
- Remote sessions
- Call metadata

Do NOT store large files inside PostgreSQL.

---

# 10. Redis

Use Redis for:

- Presence
- Online status
- Typing status
- WebSocket state
- Pub/Sub
- Rate limiting
- Temporary sessions
- Distributed locks
- Short-lived cache

Redis must not become primary persistent storage.

---

# 11. Object Storage

Use S3-compatible object storage.

Store:

- Avatars
- Message attachments
- Uploaded files
- Recordings
- Remote-transfer files

PostgreSQL stores metadata.

Object storage stores actual files.

---

# 12. Service Communication

Use:

- REST for request/response APIs
- WebSocket for realtime communication
- Redis Pub/Sub initially
- NATS later for larger-scale event communication

Services should not directly access another service's database.

Each service owns its data.

Avoid shared database tables between services.

---

# 13. Events

Use event-driven architecture where useful.

Examples:

```text
user.created
user.updated
user.online
user.offline

server.created
server.member.added
server.member.removed

channel.created
channel.deleted

message.created
message.updated
message.deleted

call.started
call.ended
call.participant.joined
call.participant.left

remote.machine.registered
remote.machine.offline
remote.session.started
remote.session.ended
remote.permission.changed
````

Start with Redis Pub/Sub.

Move to NATS when scaling requires it.

---

# 14. Repository Structure

Use monorepo.

Use:

- pnpm
- Turborepo

Structure:

```text
project/
│
├── apps/
│   │
│   ├── desktop/
│   │
│   └── services/
│       │
│       ├── api-gateway/
│       ├── auth-service/
│       ├── user-service/
│       ├── server-service/
│       ├── chat-service/
│       ├── presence-service/
│       ├── notification-service/
│       ├── call-service/
│       ├── remote-gateway/
│       └── remote-agent/
│
├── packages/
│   │
│   ├── shared-types/
│   ├── auth/
│   ├── permissions/
│   ├── database/
│   ├── events/
│   ├── websocket/
│   ├── logger/
│   └── config/
│
├── infrastructure/
│   │
│   ├── docker/
│   │   ├── docker-compose.yml
│   │   └── docker-compose.dev.yml
│   │
│   ├── nginx/
│   │   └── nginx.conf
│   │
│   └── cloudflare/
│       └── tunnel.yml
│
├── database/
│   ├── migrations/
│   └── seed/
│
├── scripts/
│
├── .env.example
├── package.json
├── pnpm-workspace.yaml
├── turbo.json
└── CLAUDE.md


---

# 15. Service Structure

Every NestJS microservice should follow similar structure.

Example:

```text
chat-service/
│
├── src/
│   ├── modules/
│   │   ├── channels/
│   │   ├── messages/
│   │   └── attachments/
│   │
│   ├── controllers/
│   ├── gateways/
│   ├── services/
│   ├── repositories/
│   ├── events/
│   ├── guards/
│   ├── interceptors/
│   ├── dto/
│   ├── config/
│   ├── app.module.ts
│   └── main.ts
│
├── Dockerfile
├── package.json
├── tsconfig.json
└── nest-cli.json
```

Keep service boundaries clear.

Do not create giant shared business modules.

---

# 16. Shared Packages

Shared packages can contain:

```text
shared-types
→ DTO types
→ event types
→ API contracts

auth
→ JWT helpers
→ authentication utilities

permissions
→ permission constants
→ permission utilities

events
→ event definitions
→ event contracts

database
→ Prisma utilities
→ database helpers

websocket
→ shared WebSocket utilities

logger
→ structured logging

config
→ environment configuration
```

Shared packages must NOT contain service-specific business logic.

---

# 17. API Structure

REST:

```text
/api/v1/auth
/api/v1/users
/api/v1/servers
/api/v1/channels
/api/v1/messages
/api/v1/roles
/api/v1/permissions
/api/v1/calls
/api/v1/remote
```

WebSocket:

```text
/ws/chat
/ws/presence
/ws/call
/ws/remote
```

`/ws/call` and `/ws/remote` carry signalling: offers, answers, ICE candidates,
and the roster of who is in the call.

Media uses WebRTC, directly between peers.

Do not send voice/video media through WebSocket. A WebSocket goes through the
gateway and the tunnel, which is exactly what media must not do.

---

# 18. Authentication

Use:

- JWT access token
- Refresh token
- OAuth

Authentication flow:

Client
|
v
API Gateway
|
v
Auth Service
|
v
Access Token + Refresh Token

Services must validate authenticated identity.

Never trust user IDs supplied by client without authentication.

---

# 19. Authorization

Use RBAC + granular permissions.

Example:

```text
OWNER
ADMIN
MODERATOR
MEMBER
GUEST
```

Permission examples:

```text
VIEW_CHANNEL
SEND_MESSAGE
DELETE_MESSAGE
MANAGE_CHANNEL
MANAGE_MEMBER
MANAGE_ROLE
START_CALL
MANAGE_CALL
REMOTE_VIEW
REMOTE_CONTROL
REMOTE_FILE_TRANSFER
```

Authorization belongs to backend.

Never rely only on desktop UI restrictions.

---

# 20. Desktop Architecture

Desktop uses Electron.

Structure:

```text
desktop/
│
├── electron/
│   ├── main.ts
│   ├── preload.ts
│   └── ipc/
│
└── src/
    ├── components/
    ├── features/
    │   ├── auth/
    │   ├── chat/
    │   ├── channels/
    │   ├── calls/
    │   ├── screen-share/
    │   ├── remote-desktop/
    │   └── settings/
    │
    ├── stores/
    ├── services/
    ├── hooks/
    └── App.tsx
```

Use Electron Main Process for privileged/native functionality.

Renderer must not receive unnecessary Node.js privileges.

Use secure IPC.

---

# 21. Future Clients

Architecture must support:

```text
Desktop
→ Electron + React + TypeScript

Web
→ React + TypeScript

Android
→ Kotlin
```

All clients use same backend APIs.

Do not create desktop-specific backend APIs unless required for native functionality.

---

# 22. Scalability

Initial deployment:

```text
Cloudflare
    ↓
Cloudflare Tunnel
    ↓
Nginx / Traefik
    ↓
Docker Compose
    ↓
Microservices
```

Later:

```text
Cloudflare
    ↓
Load Balancer
    ↓
Multiple API Gateway instances
    ↓
Multiple service instances
    ↓
Redis / NATS
    ↓
PostgreSQL
```

Each service must be stateless where possible.

Do not store session state in local container filesystem.

---

# 23. Logging

Use structured logging.

Every request should include:

- Request ID
- User ID when available
- Service name
- Timestamp
- Log level
- Error information

Use consistent log levels:

```text
debug
info
warn
error
fatal
```

Never log:

- Passwords
- JWT tokens
- Refresh tokens
- Private keys
- Secrets
- Sensitive user data

---

# 24. Error Handling

Use consistent API errors.

Example:

```json
{
  "error": {
    "code": "CHANNEL_NOT_FOUND",
    "message": "Channel not found",
    "requestId": "..."
  }
}
```

Do not expose stack traces in production.

---

# 25. Security

Mandatory:

- HTTPS/TLS
- Secure WebSocket connections
- JWT validation
- Refresh-token rotation
- Rate limiting
- Input validation
- Authorization checks
- CORS configuration
- Secure headers
- Request size limits
- File upload validation
- Audit logging for remote access

Remote access requires extra security.

Require explicit authorization before:

- Screen viewing
- Mouse/keyboard control
- File transfer
- Clipboard access
- Remote administration

Remote sessions should be auditable.

---

# 26. Development Rules

Use TypeScript strict mode.

Prefer:

```text
async/await
dependency injection
typed DTOs
typed API contracts
typed events
```

Avoid:

```text
any
global mutable state
business logic inside controllers
business logic inside gateways
direct database access from controllers
duplicated types
```

Controllers should be thin.

Services contain business logic.

Repositories handle persistence.

---

# 27. API Gateway Rules

Gateway only handles:

- Routing
- Authentication forwarding/validation where appropriate
- Rate limiting
- Load balancing
- WebSocket forwarding
- Request limits

Do NOT put:

- Chat logic
- User logic
- Server logic
- Permission business logic
- Remote desktop logic

inside gateway.

---

# 28. Media Rules

The clients are responsible for media.

NestJS is responsible for application logic and for introducing peers.

Correct:

```text
Desktop A                                    Desktop B
   |                                             |
   +---- WebSocket ----> Call Service <----------+
   |                     (SDP + ICE relay,
   |                      roster, permissions)
   |
   +<------------- WebRTC, direct -------------->+
                   voice / video / screen
```

Incorrect:

```text
Desktop
   |
   v
NestJS  (or Nginx, or the Cloudflare Tunnel)
   |
   v
Voice/Video
```

Rules:

- Never proxy media through NestJS.
- Never proxy media through Nginx or the tunnel.
- Never run a media server.
- Never require an inbound port for media.
- Never hand a client an address that only the server can reach. Peers exchange
  ICE candidates and work it out themselves; nothing in the backend needs to
  know or state where a client is.
- Signalling is small, text, and reliable - it belongs on a WebSocket. Media is
  large, continuous, and loss-tolerant - it belongs on WebRTC. Do not mix them.

---

# 29. Remote Access Rules

Never expose:

```text
3389
```

directly to internet.

Use:

```text
Remote Agent
    ↓
Outbound secure connection
    ↓
Remote Gateway
    ↓
Desktop Client
```

Remote Agent must authenticate device identity.

Each machine receives unique device identity.

Remote sessions require authorization.

---

# 30. Docker Networking

Use private Docker networks.

Example:

```text
cloudflare-network
api-network
data-network
remote-network
```

There is no media network: no container carries media.

Only required services should communicate with each network.

PostgreSQL should never be publicly exposed.

Redis should never be publicly exposed.

Microservices communicate using Docker service names internally.

Example:

```text
http://auth-service:3000
http://chat-service:3000
http://remote-gateway:3000
```

---

# 31. Environment Variables

Never commit secrets.

Use:

```text
.env
.env.development
.env.production
.env.example
```

Examples:

```text
DATABASE_URL
REDIS_URL
JWT_SECRET
JWT_REFRESH_SECRET
STUN_URLS
S3_ENDPOINT
S3_ACCESS_KEY
S3_SECRET_KEY
CLOUDFLARE_TUNNEL_TOKEN
CLOUDFLARE_TURN_KEY_ID
CLOUDFLARE_TURN_KEY_API_TOKEN
```

There is deliberately no media-server URL, key or secret. A client is never
told where to find a media server, because there is not one.

Secrets must never be committed.

---

# 32. Testing

Each service must have:

- Unit tests
- Integration tests
- API tests

Critical flows require end-to-end tests.

Important E2E flows:

```text
Registration
Login
Server creation
Channel creation
Send message
Realtime message delivery
Voice call
Screen share
Remote machine registration
Remote session
Permission enforcement
File transfer
```

---

# 33. CI/CD

Use GitHub Actions.

Pipeline:

```text
Pull Request
    ↓
Lint
    ↓
Type Check
    ↓
Unit Tests
    ↓
Integration Tests
    ↓
Build
    ↓
Docker Build
```

Production:

```text
Merge
   ↓
Build Docker Images
   ↓
Push Registry
   ↓
Deploy Services
   ↓
Health Checks
```

Services must support health endpoints.

Example:

```text
/health
```

---

# 34. Service Health

Every service should expose:

```text
/health
```

Health check should verify service availability.

Do not expose sensitive infrastructure information through health endpoints.

---

# 35. Deployment

Development:

```text
Docker Compose
```

Production initially:

```text
Docker Compose
+
Cloudflare Tunnel
+
Nginx/Traefik
```

Production later:

```text
Kubernetes
```

Do not introduce Kubernetes before needed.

---

# 36. Important Architecture Principle

Keep these concerns separate:

```text
Cloudflare Tunnel
→ Public ingress

Nginx / Traefik
→ Internal gateway

NestJS Microservices
→ Business logic

Redis
→ Realtime state / PubSub / cache

PostgreSQL
→ Persistent data

Call Service
→ Call signalling and permissions. Never media.

WebRTC peer connections (in the clients)
→ Voice / Video / Screen Share

Remote Gateway
→ Remote session signalling, input relay, permissions, audit. Never the screen.

Remote Agent
→ Machine control and screen capture

Electron
→ Desktop client
```

Do not merge these responsibilities without strong reason.

---

# 37. Final Architecture

```text
                              INTERNET
                                  │
                                  ▼
                           ┌─────────────┐
                           │ Cloudflare  │
                           └──────┬──────┘
                                  │
                           Cloudflare Tunnel
                                  │
                                  ▼
                     ┌────────────────────────┐
                     │    Nginx / Traefik     │
                     │      API Gateway       │
                     └───────────┬────────────┘
                                 │
          ┌──────────────────────┼───────────────────────┐
          │                      │                       │
          ▼                      ▼                       ▼
   ┌─────────────┐       ┌─────────────┐       ┌────────────────┐
   │ Auth Service│       │ Chat Service│       │ User Service   │
   └─────────────┘       └─────────────┘       └────────────────┘
          │                      │
          ▼                      ▼
   ┌─────────────┐       ┌─────────────┐
   │ Server   │       │  Presence   │
   │   Service   │       │   Service   │
   └─────────────┘       └─────────────┘
          │                      │
          └───────────┬──────────┘
                      ▼
                  ┌────────┐
                  │ Redis  │
                  └────────┘
                      │
                      ▼
                ┌────────────┐
                │ PostgreSQL │
                └────────────┘


              MEDIA ARCHITECTURE

  Everything above this line is signalling and goes through the
  tunnel. Nothing below it does.
  ─────────────────────────────────────────────────────────────

┌──────────┐                                   ┌──────────┐
│ Desktop  │                                   │ Desktop  │
│    A     │                                   │    B     │
└────┬─────┘                                   └─────┬────┘
     │                                               │
     │  /ws/call  ──►  Cloudflare ──► Nginx ──►  call-service
     │                 (SDP, ICE candidates, roster)  │
     │                                               │
     │◄───────────── WebRTC, direct ────────────────►│
     │        ┌── Voice                              │
     │        ├── Video                              │
     │        └── Screen Share                       │

  ICE finds the path:
     same LAN          → host candidates
     across the net    → STUN-discovered addresses
     hostile NAT       → TURN relay, only if one is configured


            REMOTE ACCESS ARCHITECTURE

┌──────────┐                                 ┌──────────────┐
│ Desktop  │                                 │ Remote Agent │
│(watcher) │                                 │  (target)    │
└────┬─────┘                                 └───────┬──────┘
     │                                               │
     │  /ws/remote ──► Cloudflare ──► Remote Gateway │
     │      session, permissions, audit,             │
     │      SDP + ICE, mouse, keyboard, clipboard    │
     │                                               │
     │◄──────── WebRTC, direct: the screen ─────────►│
                                                     │
                                                     ▼
                                             Target Machine
```

# 38. Core Rule

Build one monorepo.

Use independently deployable microservices.

Use TypeScript everywhere possible.

Use Electron for desktop.

Use NestJS for backend services.

Use peer-to-peer WebRTC for all realtime media. Run no media server.

Backend services signal; they never carry media.

Use Cloudflare Tunnel for public ingress - it carries signalling only, which is
why no port is ever opened and no service ever advertises its own address.

Use Nginx/Traefik as internal gateway.

Use PostgreSQL for persistent data.

Use Redis for realtime state and Pub/Sub.

Keep remote desktop isolated from chat/media services.

Design APIs so Web and Android clients can be added later without backend redesign.

```
```
