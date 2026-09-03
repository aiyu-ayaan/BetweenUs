---
sidebar_position: 2
title: Features
description: Complete overview of BetweenUs features — E2EE chat, P2P voice and video, synchronized media, multiplayer games, remote desktop, and 16-theme customization.
---

import useBaseUrl from '@docusaurus/useBaseUrl';

# Features & Capabilities

**BetweenUs** is a modern, privacy-first communication and collaboration platform designed as a self-hostable alternative to Discord and Slack, combined with permissioned remote desktop capabilities.

<p align="center">
  <img src={useBaseUrl('img/home.png')} alt="BetweenUs Workbench Overview" style={{maxWidth: '100%', borderRadius: '12px', boxShadow: '0 8px 30px rgba(0, 0, 0, 0.5)'}} />
</p>

---

## Feature Matrix & Platform Parity

| Capability | Desktop (Windows / Linux / macOS) | Web Client (PWA) | Android (Native Kotlin / Compose) |
| :--- | :---: | :---: | :---: |
| **End-to-End Encrypted Chat** | ✅ Full Support | ✅ Full Support | ✅ Full Support |
| **Encrypted File Attachments (&le;100MB)** | ✅ Full Support | ✅ Full Support | ✅ Full Support |
| **P2P Voice & Video Calls** | ✅ Full Support (WebRTC Mesh) | ✅ Full Support | ✅ Full Support |
| **Screen Sharing (Up to 4K / 60 FPS)** | ✅ Host & Watch | 👁️ Watch & Share | 👁️ Watch Only |
| **Listen Together (YouTube)** | ✅ Host & Sync | ✅ Host & Sync | 🎵 Audio Sync |
| **Play Together (6 Board Games & Carrom)** | ✅ Full Support | ✅ Full Support | ✅ Full Support |
| **Remote Desktop Control** | 🖥️ Agent & Controller | 🎮 Controller Only | 👁️ Viewer Only |
| **Moments (24h Ephemeral Stories)** | ✅ Full Support | ✅ Full Support | ✅ Full Support |
| **Multi-Theme Engine (16 Themes)** | ✅ 16 Themes + Accents | ✅ 16 Themes + Accents | ✅ 16 Themes + Accents |
| **Granular Server RBAC & Roles** | ✅ Full Administration | ✅ Full Administration | ✅ Member Views |
| **E2EE Key Backup & Machine Revocation** | ✅ Full Device Registry | ✅ Full Device Registry | ✅ Passphrase Backup |

---

## 1. End-to-End Encrypted Messaging

BetweenUs guarantees absolute message privacy. Messages and uploaded files are encrypted client-side using authenticated **AES-256-GCM** before touching the network. The backend only stores opaque ciphertext blobs.

<p align="center">
  <img src={useBaseUrl('img/feature-chat.png')} alt="BetweenUs E2EE Chat with Rich Markdown" style={{maxWidth: '100%', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.1)'}} />
</p>

### Key Capabilities
- **Zero-Knowledge Backend**: Servers, database operators, and network intermediaries cannot inspect message content, channel names, or attachments.
- **Rich Markdown Formatting**: Full support for headings, bold/italic inline marks, blockquotes, ordered/unordered lists, code snippets, and syntax-highlighted code blocks.
- **Interactive Messaging**: Real-time typing indicators, emoji reactions with custom pickers, threaded replies, message pinning, and edit histories.
- **Encrypted Media & Attachments**: Images, videos, PDFs, and archives up to 100 MB are encrypted in memory prior to upload and decrypted on the recipient device.
- **Local Persistence & Search**: Decrypted messages are indexed into encrypted SQLite/IndexedDB storage for instant full-text search.

---

## 2. Peer-to-Peer Voice and Video Calls

Unlike legacy platforms that route audio and video through centralized media relays (SFUs), BetweenUs connects call participants in an autonomous **WebRTC full-mesh**.

<p align="center">
  <img src={useBaseUrl('img/feature-voice.png')} alt="BetweenUs Voice & Video Settings" style={{maxWidth: '100%', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.1)'}} />
</p>

### Key Capabilities
- **Zero Media Server Overhead**: Audio and video streams flow directly peer-to-peer via DTLS-SRTP, drastically reducing infrastructure bandwidth and eliminating intermediary eavesdropping.
- **High-Fidelity Audio Controls**: Integrated software noise gate, acoustic echo cancellation, automated microphone sensitivity calibration, and push-to-talk keybindings.
- **Ultra-Low Latency Screen Sharing**: Share applications or entire monitors up to 4K resolution at 60 FPS with hardware-accelerated VP9/AV1 codecs.
- **Dynamic Topology Optimization**: Automatic STUN/TURN traversal fallback ensures connection reliability across restrictive symmetric NATs and corporate firewalls.

---

## 3. Listen Together (Synchronized YouTube)

Share musical and video experiences inside any voice channel without taxing the host's uplink bandwidth.

<p align="center">
  <img src={useBaseUrl('img/feature-listen.png')} alt="Listen Together in Voice Channels" style={{maxWidth: '100%', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.1)'}} />
</p>

### Key Capabilities
- **Zero Uplink Bandwidth**: Rather than screen-sharing video frames, Listen Together synchronizes video playback metadata (timestamp, state, queue index) across peers; each client streams video directly from the source.
- **In-App Browser & Queue**: Search youtube.com or paste direct URLs to build synchronized shared queues.
- **Automatic Speech Ducking**: Media playback volume automatically softens when participants speak, ensuring clear conversation.
- **Host & Collaborative Modes**: Server admins or room hosts can lock controls or allow any member in the call to manage the queue.

---

## 4. Play Together (Multiplayer Board Games)

Integrated, low-latency multiplayer gaming directly inside voice stages.

<p align="center">
  <img src={useBaseUrl('img/feature-games.png')} alt="Play Together Games" style={{maxWidth: '100%', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.1)'}} />
</p>

### Included Games
1. **Carrom**: Full 2D rigid-body physics simulation where striker velocity, board friction, and piece collisions are deterministically synchronized across peers.
2. **Ludo**: Classic 2 to 4 player token race with turn timers and automated dice rolls.
3. **Connect Four**: Grid-based strategy with instant move validation.
4. **Reversi / Othello**: Dynamic territory capture and flippable disk mechanics.
5. **Dots and Boxes**: Grid line drawing and box capture strategy.
6. **Tic-Tac-Toe**: Quick casual matches.

### Architecture Highlights
- **Server-Refereed Integrity**: Moves are verified and broadcasted by `call-service` using authoritative state machines, preventing client-side spoofing.
- **Spectator Theater**: Non-players in the voice channel can watch live matches in real time.

---

## 5. Multi-Theme Customization Engine

BetweenUs provides a customizable appearance system with **16 curated themes** and **8 dynamic accent tints**.

<p align="center">
  <img src={useBaseUrl('img/feature-themes.png')} alt="Themes and Appearance Settings" style={{maxWidth: '100%', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.1)'}} />
</p>

### Curated Theme Library
- **Signature & Dark**: *Dark (Iris)*, *Midnight (AMOLED 100% Black)*, *Obsidian (Deep Charcoal)*, *Slate Dark*.
- **Developer Palettes**: *Nord Frost*, *Tokyo Night*, *Catppuccin Macchiato*, *Rose Pine*, *Dracula*.
- **Vibrant & Neon**: *Cyberpunk Neon*, *Sunset Coral*, *Emerald Forest*, *Deep Ocean*.
- **Light & High Contrast**: *Daylight*, *Paper Light*, *Solarized Light*.

### Customization Options
- **Dynamic Accent Swatches**: Choose from 8 signature colors (Iris, Rose, Cyan, Emerald, Amber, Violet, Sky, Crimson).
- **Interface Density Scaling**: Adjust typography and element padding between *Compact*, *Cozy*, and *Roomy*.
- **OS Theme Auto-Sync**: Automatically switch between Daylight and dark themes based on your operating system preferences.

---

## 6. Secure Remote Desktop Access

Control unattended or assisted remote machines securely from within your BetweenUs client.

<p align="center">
  <img src={useBaseUrl('img/feature-remote.png')} alt="Remote Desktop and Machine Access" style={{maxWidth: '100%', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.1)'}} />
</p>

### Key Capabilities
- **Granular Access Control**: Authorize remote access per-device with customizable permission tiers (View Only, Input Control, File Transfer, Clipboard Sync).
- **Interactive Multi-Monitor Streaming**: View single or multi-screen setups with seamless mouse and keyboard event translation.
- **Instant Revocation**: Terminate active remote sessions immediately from the client or web portal.
- **E2EE Tunneling**: Remote video framebuffers and input event channels are negotiated via peer-to-peer WebRTC data channels with DTLS encryption.

---

## 7. 24-Hour Ephemeral Moments

Share real-time photos, thoughts, and status updates that disappear automatically after 24 hours.

<p align="center">
  <img src={useBaseUrl('img/feature-moments.png')} alt="Moments Feature" style={{maxWidth: '100%', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.1)'}} />
</p>

### Key Capabilities
- **Ephemeral Lifecycle**: Moments automatically expire and are purged from database records and storage 24 hours after posting.
- **Rich Captions & Media**: Attach photos and stylized captions with customizable privacy boundaries.
- **Non-Intrusive Discovery**: View updates from your friends list and server colleagues in a dedicated Moments feed.

---

## 8. Security, Key Backup and Identity

BetweenUs provides cryptographic account protection and device management.

<p align="center">
  <img src={useBaseUrl('img/feature-e2ee.png')} alt="Encryption & Key Backup Management" style={{maxWidth: '100%', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.1)'}} />
</p>

### Key Capabilities
- **Client-Side Key Generation**: Encryption keys are generated locally using cryptographic primitives (Web Crypto API / Libsodium).
- **Zero-Knowledge Key Backup**: Encrypt your identity key using an optional recovery passphrase or wrapped account credentials.
- **Machine Device Registry**: Inspect all active machines authorized to decrypt your conversation history and revoke compromised devices with a single click.

---

## 9. Granular Server Governance and RBAC

Manage communities and workspaces with Discord-grade permission systems.

<p align="center">
  <img src={useBaseUrl('img/feature-roles.png')} alt="Server Roles & Permissions" style={{maxWidth: '100%', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.1)'}} />
</p>

### Key Capabilities
- **Custom Role Hierarchy**: Define custom roles with custom names, hex color pickers, and hoisted member list grouping.
- **Channel-Level Overrides**: Fine-tune view, send, attach, and speak permissions on a per-channel basis.
- **Granular Admin Flags**: Centralized permissions covering channel management, member moderation, role assignment, and audit logs.
- **Configurable Invites**: Create vanity or temporary invite links with max uses and expiration timers.

---

## 10. Social Graph and Direct Messaging

Stay connected with direct messaging and real-time presence indicators.

<p align="center">
  <img src={useBaseUrl('img/feature-friends.png')} alt="Friends and Direct Messages" style={{maxWidth: '100%', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.1)'}} />
</p>

### Key Capabilities
- **Friend Management**: Send, accept, or decline friend requests with global user tag search (`username#0000`).
- **Real-Time Presence**: Show status as *Online*, *Idle*, *Do Not Disturb*, or *Invisible*.
- **Privacy & Safety Controls**: Block unwanted users, manage quiet hours, and configure desktop notifications.

---

## Next Steps

- Explore the complete [Architecture Overview](/architecture/overview).
- Learn more about the [Multi-Theme System](/architecture/themes).
- Follow the [Local Development Guide](/running-locally) to run BetweenUs on your own machine.
- Read about [End-to-End Encryption Architecture](/security/e2ee).
