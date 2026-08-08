# Nexora

Initial monorepo scaffold for a Discord-like communication platform with secure remote desktop access.

# Nexora Architecture

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
- Live streaming
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
- WebRTC
- LiveKit SDK

Desktop responsibilities:

- Chat UI
- Voice/video UI
- Screen sharing
- Live streaming
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

- LiveKit room management
- LiveKit access tokens
- Call permissions
- Participant permissions
- Call lifecycle
- Voice/video session metadata

LiveKit handles actual media transport.

Do NOT implement custom SFU.

---

# 4. LiveKit Architecture

Use LiveKit as SFU.

LiveKit handles:

- Voice
- Video
- Screen sharing
- Live streaming
- Media routing
- Participant media

Architecture:

Desktop
    |
    | WebRTC
    v
LiveKit SFU
    |
    +-- Voice
    +-- Video
    +-- Screen Share
    +-- Streaming

Call Service handles:

- Authentication
- Room creation
- Room permissions
- Token generation
- User permissions
- Call state

Media must NOT pass through NestJS API services.

---

# 5. Remote Desktop Architecture

Remote desktop must be separate from normal chat services.

Components:

- Remote Gateway
- Remote Agent
- Desktop Remote Client

Architecture:

Desktop App
    |
    | TLS / WebSocket
    v
Remote Gateway
    |
    | Secure Relay
    v
Remote Agent
    |
    v
Target Machine

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
Cloudflare Tunnel
    |
    v
Nginx / Traefik
    |
    +-- API Services
    +-- WebSocket
    +-- Remote Gateway
    +-- LiveKit

`cloudflared` can run as Docker container.

Cloudflare Tunnel and internal API Gateway have different responsibilities.

Cloudflare Tunnel:

- Secure outbound tunnel
- Public ingress
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
- `livekit`
- `postgres`
- `redis`

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
│   ├── cloudflare/
│   │   └── tunnel.yml
│   │
│   └── livekit/
│       └── livekit.yaml
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
/ws/remote
```

LiveKit uses WebRTC.

Do not send voice/video media through WebSocket.

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

# 28. LiveKit Rules

LiveKit is responsible for media.

NestJS is responsible for application logic.

Correct:

```text
Desktop
   |
   +---- API ----> Call Service
   |                  |
   |                  +---- LiveKit token
   |
   +---- WebRTC ----> LiveKit SFU
```

Incorrect:

```text
Desktop
   |
   v
NestJS
   |
   v
Voice/Video
```

Never proxy media through NestJS.

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
media-network
remote-network
```

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
LIVEKIT_API_KEY
LIVEKIT_API_SECRET
S3_ENDPOINT
S3_ACCESS_KEY
S3_SECRET_KEY
CLOUDFLARE_TUNNEL_TOKEN
```

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

LiveKit
→ Voice / Video / Screen Share / Streaming

Remote Gateway
→ Remote session relay

Remote Agent
→ Machine control

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

Desktop
    │
    │ WebRTC
    ▼
┌─────────────────┐
│   LiveKit SFU   │
└─────────────────┘
    │
    ├── Voice
    ├── Video
    ├── Screen Share
    └── Streaming


            REMOTE ACCESS ARCHITECTURE

Desktop
    │
    ▼
Remote Gateway
    │
    │ Secure Relay
    ▼
Remote Agent
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

Use LiveKit for all realtime media.

Use Cloudflare Tunnel for public ingress.

Use Nginx/Traefik as internal gateway.

Use PostgreSQL for persistent data.

Use Redis for realtime state and Pub/Sub.

Keep remote desktop isolated from chat/media services.

Design APIs so Web and Android clients can be added later without backend redesign.

```
```
