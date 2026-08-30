---
sidebar_position: 1
---

# Services Overview

Every service is a small NestJS app under `apps/services/<name>`, its own
`package.json` and `Dockerfile` target. This section is the REST/WebSocket
surface of each one, generated against the actual controllers and gateways
in the repo — see [Microservices](/architecture/microservices) for what each
one is *for*.

| Service | REST prefix | WebSocket | Owns |
| --- | --- | --- | --- |
| [auth-service](/services/auth-service) | `/api/v1/auth`, `/api/v1/admin` | — | Sessions, OAuth, admin panel auth |
| [server-service](/services/server-service) | `/api/v1/servers`, `/api/v1/channels` | — | Servers, roles, channels, invites |
| [chat-service](/services/chat-service) | `/api/v1/messages`, `/api/v1/friends`, `/api/v1/dm`, `/api/v1/e2ee`, `/api/v1/uploads` | `/ws/chat` | Messages, DMs, friends, E2EE keys, uploads |
| [presence-service](/services/presence-service) | `/api/v1/internal/presence` (internal) | `/ws/presence` | Online / last seen / typing / voice roster state |
| [notification-service](/services/notification-service) | `/api/v1/notifications` | — | Mute/quiet-hour prefs, unread, push devices |
| [call-service](/services/call-service) | `/api/v1/calls` | `/ws/call` | Call signalling, ICE config |
| [remote-gateway](/services/remote-gateway) | `/api/v1/remote` | `/ws/remote` | Machines, grants, sessions, audit |

```mermaid
flowchart LR
    %% INGRESS
    subgraph T_INGRESS ["API Gateway (:8080)"]
        direction TB
        Nginx["<b>Nginx Ingress Proxy</b><br/><i>/api/v1/* & /ws/*</i>"]
    end

    %% REST & WS ROUTING
    subgraph T_REST ["REST Services"]
        AuthSvc["<b>auth-service (:3001)</b><br/><i>/api/v1/auth<br/>/api/v1/admin</i>"]
        ServerSvc["<b>server-service (:3003)</b><br/><i>/api/v1/servers<br/>/api/v1/channels</i>"]
        NotifSvc["<b>notification-service (:3006)</b><br/><i>/api/v1/notifications</i>"]
    end

    subgraph T_HYBRID ["Dual REST + WebSocket Services"]
        ChatSvc["<b>chat-service (:3004)</b><br/><i>/api/v1/messages, /dm<br/>/ws/chat</i>"]
        PresenceSvc["<b>presence-service (:3005)</b><br/><i>/api/v1/internal/presence<br/>/ws/presence</i>"]
        CallSvc["<b>call-service (:3007)</b><br/><i>/api/v1/calls<br/>/ws/call</i>"]
        RemoteGW["<b>remote-gateway (:3008)</b><br/><i>/api/v1/remote<br/>/ws/remote</i>"]
    end

    Nginx -->|"/api/v1/auth"| AuthSvc
    Nginx -->|"/api/v1/servers"| ServerSvc
    Nginx -->|"/api/v1/notifications"| NotifSvc
    Nginx ==>|"/api/v1/messages & /ws/chat"| ChatSvc
    Nginx -->|"/ws/presence"| PresenceSvc
    Nginx -->|"/ws/call"| CallSvc
    Nginx -->|"/ws/remote"| RemoteGW

    %% Styling
    classDef primary fill:#1e40af,stroke:#60a5fa,stroke-width:2px,color:#ffffff;
    classDef svc fill:#0f172a,stroke:#475569,stroke-width:1px,color:#f8fafc;

    class Nginx,ChatSvc primary;
    class AuthSvc,ServerSvc,NotifSvc,PresenceSvc,CallSvc,RemoteGW svc;
```

All REST routes above are mounted under Nginx's `/api/v1` prefix; the table
shows each controller's own path segment. Every service also exposes
`/health`.

`api-gateway` (Nginx/Traefik config, no app code) and `remote-agent` (a
scaffold — the desktop app is the real agent) don't have their own API
surface to document here.
