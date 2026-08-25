---
sidebar_position: 1
slug: /intro
---

import useBaseUrl from '@docusaurus/useBaseUrl';

# BetweenUs

BetweenUs is a Discord-like communication platform with secure remote desktop
access. A single account gets chat, voice/video calls, screen sharing, and
permissioned remote control of another machine — across a desktop client
today, with web and Android planned in the same backend.

<p>
  <img src={useBaseUrl('img/home.png')} alt="BetweenUs desktop client" style={{maxWidth: '100%', borderRadius: '8px'}} />
</p>

## What's in these docs

- **[Architecture](/architecture/overview)** — the microservices, the
  peer-to-peer media design, why there is no media server, and the
  [Android client](/architecture/android-client).
- **[Listen Together](/architecture/listen-together)** — synchronized YouTube
  playback inside calls with zero uplink, in-app YouTube browsing, and automatic speech ducking.
- **[System Design](/system-design/auth-and-permissions)** — auth, RBAC,
  events, ingress through Cloudflare Tunnel.
- **[Database](/database/schema)** — the Prisma schema, model by model, with
  an ERD.
- **[Services](/services/overview)** — one page per microservice: what it
  owns, its REST/WebSocket surface, what it never does.
- **[Deployment](/deployment/docker-compose)** — Docker Compose, the release
  pipeline, CI/CD.
- **[Security](/security/overview)** and **[E2EE](/security/e2ee)** — trust
  boundaries, encryption design, and the gaps that are open on purpose.
- **[Running Locally](/running-locally)** — clone to running chat in a few
  commands.

## Core capabilities

- **Authentication & Accounts**: JWT + refresh-token rotation with reuse detection, Google & GitHub OAuth sign-in.
- **Servers & Channels**: Public and private channels, custom roles with colors, per-member overrides, invite links with limits.
- **End-to-End Encrypted Chat**: Messages, edits, reactions, replies, pins, rich markdown parsing (bulleted/numbered lists, inline marks, code blocks), and encrypted attachments up to 100 MB.
- **Voice, Video & Screen Share**: Peer-to-peer WebRTC mesh, camera, screen sharing with interactive remote control handover and multi-cursor overlays.
- **Listen Together**: Synchronized YouTube playback in voice calls, browse youtube.com in-app, click-to-play with zero uplink, and automatic speech ducking.
- **Remote Desktop**: Screen viewing, remote control, clipboard sync, multi-monitor selection, granular permission grants with expiry, and audit trail.
- **Presence & Notifications**: Status selection, typing indicators, desktop tray, quiet hours, push suppression across devices, and FCM push notifications.

## Technology at a glance

| Layer | Technology |
| --- | --- |
| Desktop client | Electron, React, TypeScript, Tailwind CSS, Zustand |
| Web client | Same React UI, served by Vite, mounted at the gateway root |
| Android client | Kotlin, Jetpack Compose |
| Backend | Node.js, TypeScript, NestJS microservices |
| Realtime media | WebRTC, peer-to-peer, no SFU |
| Signalling | WebSocket, relayed by NestJS gateways |
| Database | PostgreSQL via Prisma |
| Realtime/cache state | Redis (presence, pub/sub, rate limiting) |
| Object storage | S3-compatible (or local disk in dev) |
| Ingress | Cloudflare Tunnel → Nginx → services |
| Containers | Docker Compose (dev + prod), one Dockerfile with multiple targets |

Everything here is generated and maintained against the actual source in
[github.com/aiyu-ayaan/BetweenUs](https://github.com/aiyu-ayaan/BetweenUs) — where a
page and the code disagree, the code is right and this page is stale; open an
issue.
