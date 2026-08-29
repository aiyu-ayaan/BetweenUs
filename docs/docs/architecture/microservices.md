---
sidebar_position: 2
---

# Microservices

Every service is NestJS + TypeScript, has its own `package.json`, its own
`Dockerfile` target, and a clear responsibility. None of them share a
database connection string in the deployed target shape; the MVP shares one
Postgres schema (see [Database](/database/schema)) as a documented,
temporary shortcut.

## Microservices Topology & Inter-Service Event Mesh

```mermaid
flowchart TD
    %% TIER 1: INGRESS GATEWAY
    subgraph T_INGRESS ["Trust Boundary 1: Ingress DMZ"]
        Gateway["<b>API Gateway (Nginx :8080)</b><br/><i>REST Routing · WebSocket Upgrades · Rate Limits</i>"]
    end

    %% TIER 2: DOMAIN SERVICES
    subgraph T_SERVICES ["Trust Boundary 2: Application Microservices Mesh"]
        direction TB
        AuthSvc["<b>auth-service (:3001)</b><br/><i>Sessions · JWT · OAuth</i>"]
        ServerSvc["<b>server-service (:3003)</b><br/><i>Servers · Channels · RBAC</i>"]
        ChatSvc["<b>chat-service (:3004)</b><br/><i>E2EE Routing · Uploads · /ws/chat</i>"]
        PresenceSvc["<b>presence-service (:3005)</b><br/><i>Status · Typing · /ws/presence</i>"]
        NotifSvc["<b>notification-service (:3006)</b><br/><i>Mutes · Badges · Push Dispatch</i>"]
        CallSvc["<b>call-service (:3007)</b><br/><i>Signaling · Rosters · /ws/call</i>"]
        RemoteGW["<b>remote-gateway (:3008)</b><br/><i>Remote Desktop · /ws/remote</i>"]
    end

    %% TIER 3: DATA & EVENT BUS
    subgraph T_DATA ["Trust Boundary 3: Persistence & Event Bus"]
        direction LR
        PG[("<b>PostgreSQL (:5432)</b><br/><i>Prisma ORM · Relational Store</i>")]
        Redis[("<b>Redis (:6379)</b><br/><i>@betweenus/events Pub/Sub</i>")]
        Storage[("<b>Storage Driver</b><br/><i>Encrypted Blobs (Local/S3)</i>")]
    end

    %% INGRESS ROUTING
    Gateway ==>|"Proxy /api/v1/chat & /ws/chat"| ChatSvc
    Gateway -.->|"Proxy /api/v1/auth"| AuthSvc
    Gateway -.->|"Proxy /api/v1/servers"| ServerSvc
    Gateway -.->|"Proxy /ws/presence"| PresenceSvc
    Gateway -.->|"Proxy /api/v1/notifications"| NotifSvc
    Gateway -.->|"Proxy /ws/call"| CallSvc
    Gateway -.->|"Proxy /ws/remote"| RemoteGW

    %% PRIMARY DATA & EVENT FLOWS
    ChatSvc ==>|"Persist Ciphertext"| PG
    ChatSvc ==>|"Publish message.created"| Redis
    ChatSvc -.->|"Store Encrypted Attachments"| Storage
    AuthSvc -.-> PG
    ServerSvc -.-> PG
    RemoteGW -.-> PG

    Redis -.->|"Event Stream"| PresenceSvc
    Redis -.->|"Event Stream"| NotifSvc
    Redis -.->|"Call Rosters"| CallSvc

    %% Styling
    classDef primary fill:#1e40af,stroke:#60a5fa,stroke-width:2px,color:#ffffff;
    classDef service fill:#0f172a,stroke:#475569,stroke-width:1px,color:#f8fafc;
    classDef data fill:#1e293b,stroke:#64748b,stroke-width:1px,color:#f1f5f9;

    class Gateway,ChatSvc,PG,Redis primary;
    class AuthSvc,ServerSvc,PresenceSvc,NotifSvc,CallSvc,RemoteGW service;
    class Storage data;
```

## API Gateway

Nginx or Traefik. Routing, WebSocket upgrade, rate limiting, load balancing,
request-size limits. No business logic ever lands here — see
[Ingress](/system-design/ingress) for the actual `nginx.conf` shape.

## Auth Service

Registration, login, logout, JWT access tokens, refresh-token rotation,
OAuth (Google/GitHub), session management, password management, account
verification. Full flow: [Auth & Permissions](/system-design/auth-and-permissions).

## User Service

User profiles, avatars, settings, devices, friend relationships, user status.

## Server Service

Servers (Discord-style "guilds"), members, roles, permissions, channel
management, invitations, server settings. Owns the effective-permission
resolver (`roleDefaults ∪ customRoles ∪ granted \ denied`) that chat, call
and presence all call into via `@betweenus/database`.

## Chat Service

Text channels, direct messages, messages, editing, deletion (tombstones),
replies, reactions, attachments, message history. Realtime fanout over
WebSocket (`/ws/chat`), Redis Pub/Sub between instances.

## Presence Service

Online / offline / idle status, typing indicators, activity status. All
state lives in Redis — presence-service holds nothing durable. `/ws/presence`.

## Notification Service

Raises **no** notifications itself — the desktop client already receives
every message over `/ws/chat` and is the only thing that knows what's on
screen. What it owns is the state that has to outlive the client: mutes,
quiet hours, read markers, and (phase 27) minting the data-only FCM push
that tells a backgrounded device something happened.

## Call Service

Call signalling only (`/ws/call`): who may join which call, the roster of
peers, relaying offers/answers/ICE candidates, handing out ICE server
config. **Call Service never sees media** — it is a switchboard, not an SFU.
See [Peer-to-Peer Media](/architecture/media).

## Remote Gateway

Session handshake, offer/answer/ICE relay for the remote-desktop peer
connection, mouse/keyboard/clipboard event relay, permission enforcement,
audit trail. Never carries the screen itself. See
[Remote Desktop](/architecture/remote-desktop).

## Remote Agent

A scaffold for a headless agent. In practice the desktop app *is* the agent
on a machine somebody uses — it already has `desktopCapturer`, a WebRTC
publisher and `safeStorage` for the enrollment credential, so a second
process duplicating that would be scaffolding for its own sake.

## Rules every service follows

- Controllers are thin; services hold business logic; repositories handle
  persistence.
- No service reaches into another service's database directly — they call
  APIs, or publish/subscribe to events (see [Events](/system-design/events)).
- Every service exposes `/health`, and it says nothing sensitive.
- TypeScript strict mode; no `any`; typed DTOs and typed events.
