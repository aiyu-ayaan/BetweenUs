---
sidebar_position: 3
---

# Ingress: Cloudflare Tunnel

## The rule everything else is built around

A Cloudflare Tunnel carries HTTP and WebSocket. It does not carry UDP, and
WebRTC media is UDP. Putting a media server behind the tunnel means
smuggling media around it somehow — every one of those workarounds breaks.
Peer-to-peer media never has this problem, because media never goes near the
tunnel at all. See [Peer-to-Peer Media](/architecture/media).

```mermaid
flowchart TD
    %% TIER 1: PUBLIC INTERNET
    subgraph T_PUBLIC ["Trust Boundary 1: Public Internet (Untrusted Origin)"]
        direction LR
        UserClient["<b>Multi-Platform Clients</b><br/><i>Desktop · Web · Mobile</i>"]
        RemoteHost["<b>Enrolled Target Machines</b><br/><i>Outbound Remote Agents</i>"]
    end

    %% TIER 2: CLOUDFLARE EDGE
    subgraph T_EDGE ["Trust Boundary 2: Cloudflare Edge Network"]
        CF["<b>Cloudflare Edge (DDoS / WAF / SSL)</b><br/><i>Terminates Public HTTPS / WSS</i>"]
    end

    %% TIER 3: INGRESS TUNNEL & GATEWAY DMZ
    subgraph T_INGRESS ["Trust Boundary 3: Ingress DMZ (Zero Inbound Open Ports)"]
        direction TB
        CFTunnel["<b>Cloudflare Tunnel Daemon</b> (cloudflared)<br/><i>Encapsulated Outbound QUIC/TLS Tunnel</i>"]
        Gateway["<b>API Gateway (Nginx :8080)</b><br/><i>Rate Limiting · WebSocket Upgrades · Header Sanitization</i>"]
        CFTunnel ==>|"Local HTTP Proxy"| Gateway
    end

    %% TIER 4: INTERNAL BACKEND SERVICES
    subgraph T_SERVICES ["Trust Boundary 4: Internal Docker Network"]
        direction LR
        APIServices["<b>REST APIs</b><br/><i>auth · server · chat · notif</i>"]
        WSSignaling["<b>WebSocket Gateways</b><br/><i>/ws/chat · /ws/presence · /ws/call</i>"]
        RemoteRelay["<b>Remote Gateway</b><br/><i>/ws/remote</i>"]
    end

    %% PRIMARY INGRESS FLOW
    UserClient ==>|"1. Public HTTPS/WSS (Port 443)"| CF
    RemoteHost ==>|"1. Outbound /ws/remote (Port 443)"| CF
    CF ==>|"2. Route via Tunnel"| CFTunnel
    Gateway ==>|"3. Dispatch REST"| APIServices
    Gateway ==>|"3. Route WebSockets"| WSSignaling
    Gateway ==>|"3. Route Remote Sessions"| RemoteRelay

    %% DIRECT P2P MEDIA MESH
    UserClient <-.->|"Direct P2P WebRTC UDP (Never Touches Tunnel or Gateway)"| UserClient

    %% Styling
    classDef primary fill:#1e40af,stroke:#60a5fa,stroke-width:2px,color:#ffffff;
    classDef edge fill:#0f172a,stroke:#475569,stroke-width:1px,color:#f8fafc;
    classDef service fill:#1e293b,stroke:#64748b,stroke-width:1px,color:#f1f5f9;

    class UserClient,RemoteHost,CF,CFTunnel,Gateway primary;
    class APIServices,WSSignaling,RemoteRelay service;
```

```text
Signalling:  Client → Cloudflare → Tunnel → Nginx → call-service
                       (WebSocket, same shape as chat)

Media:       Client <========================================> Client
                       (WebRTC, direct, never touches Cloudflare)
```

## What this buys

- **No UDP port is ever opened.**
- **No service ever advertises its own address.** There is deliberately no
  "advertised address" setting anywhere — that class of bug (correct on the
  server, wrong for every client, invisible to whatever the operator can
  test locally) was the single most expensive bug in an earlier design that
  used an SFU.
- **One hostname.** Signalling is a WebSocket path on the same gateway as
  everything else.
- **Reachable from any network** a client can reach the site from at all.

## Reaching the other peer

| Case | What carries the media |
| --- | --- |
| Same LAN | Direct, host candidates |
| Different networks, ordinary NAT | Direct, STUN-discovered addresses |
| Symmetric / carrier-grade NAT | TURN relay, only if one is configured — otherwise no path exists |

STUN needs no tunnel and no port — the client dials a public STUN server
itself. TURN is optional and off by default; when an operator wants that
last category of network to work, Cloudflare's own TURN service fits
naturally since it's outbound-only too, and `call-service` mints short-lived
credentials for it per call.

On a STUN-only deployment the last row is the accepted ceiling, and it is a
narrower row than it looks. Most failures that *present* as "no path" are a
lost candidate race rather than a genuine absence of one, so the client
retries a broken link properly — backed-off ICE restarts, then up to three
full connection rebuilds with fresh ports — before concluding anything. See
[Media](/architecture/media). Only what survives all of that is this row.

## Two layers, two jobs

**Cloudflare Tunnel:**
- Secure outbound tunnel
- Public ingress for HTTP and WebSocket
- No port forwarding, no direct public server exposure

**Nginx / Traefik:**
- Internal routing, load balancing
- WebSocket routing, rate limiting
- Service routing

`cloudflared` can run as its own Docker container (`--profile public`), or
an operator can point an existing tunnel they already run at
`http://localhost:8080` — the gateway's published `GATEWAY_PORT`. Both work;
the difference is one line of tunnel config.

## Route map

```text
/           web client (apps/web, built static bundle)
/admin      admin panel (apps/admin)
/api/v1/*   REST, routed to the owning service
/ws/*       WebSocket, routed to the owning service's gateway
```

Nginx matches the longest prefix, so `/` never shadows `/admin`, `/api`, or
`/ws`.
