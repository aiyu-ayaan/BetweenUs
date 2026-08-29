---
sidebar_position: 5
---

# presence-service

Online/offline/idle/DND status, typing indicators, and voice rosters. All
state lives in Redis; the service itself holds nothing durable.

## `/ws/presence`

Connects, publishes status changes, subscribes to the presence of accounts
the client cares about (friends, server members, a channel's participants).

## `/api/v1/internal/presence` (internal only)

Not routed through the public Nginx surface — used by other services
server-to-server.

| Method | Path | What it does |
| --- | --- | --- |
| GET | `/focus` | Whether an account currently has a given channel focused (used for notification suppression) |
| GET | `/online` | Online count for a server (used by the invite-preview card) |

Requests are made with a two-second timeout and answered with `null` on any
failure — an invite preview that hangs because presence is restarting is
worse than one that just omits the online count.

## Status resolution

Online / idle / do-not-disturb / invisible are what the client *chose*;
connected-or-not is what the server actually knows. `invisible` is resolved
to `offline` server-side before it's told to anyone else — a status that
leaks in the payload isn't invisible. The account's own client still sees
its real status.

```mermaid
flowchart TD
    %% TIER 1: CLIENT PRESENCE EMISSION
    subgraph T_CLIENT ["Trust Boundary 1: Client Endpoint"]
        ClientChosen["<b>Client Emits Presence Frame</b><br/><i>WS /ws/presence { status: 'invisible' | 'dnd' | 'idle' | 'online' }</i>"]
    end

    %% TIER 2: PRESENCE SERVICE ENGINE
    subgraph T_PRESENCE ["Trust Boundary 2: presence-service (:3005)"]
        direction TB
        FilterInvisible{"<b>Status == 'invisible'?</b>"}
        MaskOffline["<b>Mask as 'offline' for Public Fanout</b><br/><i>(Preserve 'invisible' on User's own socket)</i>"]
        PassThrough["<b>Preserve Requested Status</b>"]
        RedisPresence[("<b>Redis (Ephemeral Presence Store)</b><br/><i>presence:user:id · presence:focus:ch · presence:roster:call</i>")]

        FilterInvisible -->|"Yes"| MaskOffline --> RedisPresence
        FilterInvisible -->|"No"| PassThrough --> RedisPresence
    end

    %% TIER 3: RECIPIENTS & INTERNAL CONSUMERS
    subgraph T_CONSUMERS ["Trust Boundary 3: Realtime Fanout & Internal Query"]
        direction TB
        PublicSubscribers["<b>Friends / Server Members</b><br/><i>Receives Masked Status Event</i>"]
        NotifQuery["<b>notification-service</b><br/><i>GET /internal/presence/focus</i>"]
    end

    ClientChosen ==> FilterInvisible
    RedisPresence ==>|"Realtime Pub/Sub Fanout"| PublicSubscribers
    RedisPresence -.->|"Fast In-Memory Lookup"| NotifQuery

    %% Styling
    classDef primary fill:#1e40af,stroke:#60a5fa,stroke-width:2px,color:#ffffff;
    classDef service fill:#0f172a,stroke:#475569,stroke-width:1px,color:#f8fafc;
    classDef decision fill:#0f172a,stroke:#38bdf8,stroke-width:2px,color:#f8fafc;
    classDef data fill:#1e293b,stroke:#64748b,stroke-width:1px,color:#f1f5f9;

    class ClientChosen,FilterInvisible,MaskOffline,PassThrough primary;
    class PublicSubscribers,NotifQuery service;
    class FilterInvisible decision;
    class RedisPresence data;
```
