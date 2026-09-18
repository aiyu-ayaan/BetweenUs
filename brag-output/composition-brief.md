# Hyperframes Composition Brief: BetweenUs

## Objective
Create a high-impact, short vertical launch video (9:16) for BetweenUs showcasing its zero-media-server architecture, end-to-end encrypted messaging, peer-to-peer WebRTC voice/video mesh, interactive activities (synchronized YouTube listening & Carrom gaming), ephemeral 24h Moments, and outbound remote desktop management.

## Output
- **Composition directory:** `brag-output/composition/`
- **Rendered video:** `brag-output/brag.mp4`
- **Poster frame (Frame 0):** `brag-output/brag.jpg`
- **Format:** Vertical (9:16) — `1080 × 1920`
- **Frame Rate:** 30 fps
- **Duration:** Exactly 29.5 seconds

## Source Material
- **Project root:** `.`
- **Primary references:**
  - `README.md` (Product overview, security model, feature architecture)
  - `apps/desktop/tailwind.theme.mjs` (Color tokens, border radiuses, dark theme variables)
  - `docs/superpowers/specs/2026-09-18-betweenus-video-and-screenshots-design.md` (Approved design specification)
  - `docs/superpowers/plans/2026-09-18-betweenus-video-and-screenshots-design.md` (Implementation plan)
- **Product Name:** `BetweenUs`
- **Tagline / Strongest Claim:**
  - *"Zero Media Server Infrastructure. Messages and media are sealed with AES-256-GCM — the server never holds any key that can decrypt it. Voice, video, and screen sharing stream directly between peers."*
- **Key UI Moments to Recreate:**
  - Floating dark workbench cards with hairline borders and frosted headers.
  - Live E2EE chat with incoming messages, code snippet attachment, and animated spring reaction chips (`🔥 4`, `🚀 2`, `✨ 3`).
  - 4-participant WebRTC P2P mesh grid with real-time emerald speaker halos and sub-20ms latency telemetry.
  - Split collaborative activity stage: Listen Together YouTube player with auto-ducking + Play Together Carrom physics game.
  - 24-hour ephemeral Moments story viewer with segmented progress bars and encrypted recipient verification.
  - Secure Outbound Remote Desktop admin session with live cursor tracking over zero inbound ports.
  - 3D converging device perspective (Desktop, Web, Android) culminating in the glowing Iris logo lockup.
- **Copy That Must Appear Verbatim:**
  - `"COMMUNICATION WITHOUT COMPROMISE."`
  - `AES-256-GCM • Zero Media Server`
  - `Floating Panel Workbench • True End-to-End Encryption`
  - `WebRTC P2P Mesh • Direct Device-to-Device Stream`
  - `Synchronized YouTube Listening & In-Call Board Games`
  - `24h Ephemeral Stories • Outbound Remote Desktop`
  - `"Your Private Digital Space."`
  - `Desktop • Web • Android`

## Creative Direction
- **Tone Preset:** `polished`
- **Creative Direction:** Serious, elegant dark-workbench product film with confident technical feature reveals.
- **Interpretation:** Pacing prioritizes legibility, confidence, and restraint over frantic flashing. Floating cards slide in with smooth cubic-bezier physics, typography holds long enough to absorb technical claims, and the color palette strictly preserves BetweenUs's premium cool-dark aesthetic.
- **Angle:** Zero Media Server Infrastructure. Client-sealed AES-256-GCM encryption meets a fluid, rich collaboration workbench without compromising privacy or performance.
- **Hook (0.0s – 4.0s):** High-contrast kinetic typography drops down into deep near-black space before sealing with a glowing cryptographic lock and `AES-256-GCM • ZERO MEDIA SERVER` badge.
- **Outro / Punchline (25.0s – 29.5s):** Converging cross-platform cards settle around the radiant Iris logo, locking into a crisp, high-contrast poster frame: *"Your Private Digital Space. Desktop • Web • Android."*
- **Avoid:**
  - Generic SaaS language ("streamline your workflow", "all-in-one productivity tool").
  - Abstract filler visuals (meaningless geometric shapes or non-product graphics).
  - Unrelated visual redesigns (preserve the `#0b0f19` canvas, `#111827` cards, and `#6366f1` Iris accents).

## Visual Identity
- **Ground (Canvas):** `#0b0f19` (`rgb(11, 15, 25)`)
- **Panels / Surfaces:** `#111827` (`surface-900`), `#1f2937` (`surface-800`), `#374151` (`surface-700`)
- **Accent Ramp (Iris):**
  - Primary Iris: `#6366f1`
  - Light Iris: `#818cf8`
  - Deep Iris: `#4f46e5`
- **Status & Feedback Indicators:**
  - Emerald / Speaking: `#3fd68c`
  - Amber / Idle: `#f5b83d`
  - Cyan / Active Stream: `#38bdf8`
  - Rose / Mute / Encrypted Alert: `#f43f5e`
- **Text:**
  - High Contrast: `#f9fafb`
  - Body Text: `#d1d5db`
  - Muted Text: `#9ca3af`
- **Borders & Dividers:** Hairline `rgba(255, 255, 255, 0.08)`
- **Typography:**
  - Display: `Inter`, `Segoe UI Variable Display`, `system-ui`, `sans-serif`
  - Monospace: `JetBrains Mono`, `Fira Code`, `ui-monospace`, `monospace`
- **Visual References from Project:**
  - Desktop Hero: `pictures/home.png`
  - Android Client: `pictures/home-android.png`
  - Voice & Activities: `pictures/voice-listen-play.png`
  - Moments Viewer: `pictures/moments-viewer.png`
  - Remote Desktop: `pictures/remote-desktop.png`

## Storyboard

### Act 1 — The Hook (0.0s – 4.0s, duration: 4.0s)
- **Visual:** Deep near-black background (`#0b0f19`) with pulsing Iris radial gradient glow.
- **Copy:** *"COMMUNICATION WITHOUT COMPROMISE."*
- **Interaction:** Kinetic typography slams down at 0.5s. Cryptographic lock icon seals into place at 1.8s with glowing badge: `AES-256-GCM • Zero Media Server`.
- **Hold:** Settled display holds until 4.0s for maximum legibility.

### Act 2 — Floating Workbench & E2EE Chat (4.0s – 9.0s, duration: 5.0s)
- **Visual:** Floating Desktop Workbench card with frosted glass top bar and hairline border slides into view.
- **Interaction:** Live chat messages animate into the view; inline syntax-highlighted TypeScript snippet (`createMeshPeer`) renders; reaction chips (`🔥 4`, `🚀 2`, `✨ 3`) pop in sequentially on consecutive beats with spring physics.
- **Tagline Pill:** `Floating Panel Workbench • True End-to-End Encryption`.

### Act 3 — Zero-Media-Server P2P Voice & Video (9.0s – 14.0s, duration: 5.0s)
- **Visual:** Voice stage displaying a 2x2 grid of participant video and avatar tiles.
- **Interaction:** Active speaker halos pulse in glowing emerald (`#3fd68c`); tile 3 displays live direct screen share; top HUD displays telemetry: `WebRTC P2P Mesh • 18ms DTLS-SRTP • 0 Server Relays`.
- **Tagline Pill:** `WebRTC P2P Mesh • Direct Device-to-Device Stream`.

### Act 4 — Listen Together & Play Together (14.0s – 19.5s, duration: 5.5s)
- **Visual:** Split collaborative activity view.
  - **Top Card:** Listen Together YouTube player with synced album art, scrub timeline, and `Audio Ducking Active` pill.
  - **Bottom Card:** Play Together Carrom physics game showing striker positioning line, coin collision, and active turn indicator.
- **Interaction:** Striker release aligns with audio beat; progress bar advances smoothly.
- **Tagline Pill:** `Synchronized YouTube Listening & In-Call Board Games`.

### Act 5 — 24h Moments & Remote Desktop (19.5s – 25.0s, duration: 5.5s)
- **Visual:** Dual feature progression:
  - **19.5s – 22.2s:** Moments story player with segmented progress indicators, 24-hour expiration pill, and encrypted recipient badge: `Key frozen for 5 friends`.
  - **22.2s – 25.0s:** Card flips into Outbound Remote Desktop management console with live cursor tracking, zero inbound port badge, and 12ms latency indicator.
- **Tagline Pill:** `24h Ephemeral Stories • Outbound Remote Desktop`.

### Act 6 — Cross-Platform Climax & Outro (25.0s – 29.5s, duration: 4.5s)
- **Visual:** Three floating device frames (Desktop Electron, Web Browser, Native Android Compose) converge in 3D perspective around the radiant Iris logo.
- **Interaction:** Devices settle into a balanced background arrangement at 26.8s. Central logo and typography settle at 27.5s.
- **Settled Copy:**
  - *"Your Private Digital Space."*
  - `Desktop • Web • Android`
- **Poster Anchor:** Fully settled, crystal-clear frame held from 28.0s to 29.5s for Frame 0 thumbnail extraction.

## Audio
- **Audio Role:** Driving electronic groove providing momentum without cluttering feature legibility.
- **Soundtrack:** `.agents/skills/brag/assets/music/happy-beats-business-moves-vol-1-by-ende-dot-app.mp3` (copied to `brag-output/composition/assets/music/track.mp3`).
- **Volume & Envelope:**
  - `0.0s – 1.0s`: Smooth volume fade-in from 0.0 to 0.85.
  - `1.0s – 27.5s`: Sustained driving level at 0.85 volume.
  - `27.5s – 29.5s`: Logarithmic outro fade to 0.0 under the settled logo card.
- **Music Cue Guidance:**
  - Tempo: ~120.2 BPM (~0.50s per beat).
  - Strong cues: 16.02s, 17.02s, 17.52s, 18.52s, 20.02s, 23.02s.
  - Scene boundary transitions: 4.0s, 9.0s, 14.0s, 19.5s, 25.0s.
- **Audio-Reactive Treatment:** Subtle radial Iris background glow and participant speaking rings gently pulsate with music energy.
- **SFX Posture:** None (Music Only mode per user direction).
- **Voiceover:** None (Music Only mode per user direction).

## Hyperframes Instructions
1. Initialize Hyperframes composition in `brag-output/composition/`:
   - `hyperframes.json` with `width: 1080`, `height: 1920`, `fps: 30`, `duration: 29.5`.
   - Audio linked via `<audio>` tag targeting `assets/music/track.mp3`.
2. Construct scenes in `index.html` with explicit timing attributes (`data-start`, `data-duration`):
   - Scene 1: `data-start="0"` `data-duration="4.0"`
   - Scene 2: `data-start="4.0"` `data-duration="5.0"`
   - Scene 3: `data-start="9.0"` `data-duration="5.0"`
   - Scene 4: `data-start="14.0"` `data-duration="5.5"`
   - Scene 5: `data-start="19.5"` `data-duration="5.5"`
   - Scene 6: `data-start="25.0"` `data-duration="4.5"`
3. Implement styling in `styles.css` using modern CSS transitions, flexbox/grid, and SVG components.
4. Ensure all text meets contrast standards against `#0b0f19` and card backgrounds.
5. Guarantee seek safety: keyframes and states must render deterministically at any timestamp without cumulative drift.
6. Verify composition passes `npx hyperframes check` with 0 errors before proceeding to render.
