# BetweenUs 9:16 Video & Professional Screenshot Suite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a high-retention 28–30s vertical (9:16) launch video using the `brag` skill + Hyperframes and generate a comprehensive suite of 5 interactive, high-resolution screenshots for BetweenUs.

**Architecture:** 
- Programmatic HTML5/SVG screen rendering engine to produce razor-sharp 2K/4K desktop and mobile screenshots (`home.png`, `home-android.png`, `voice-listen-play.png`, `moments-viewer.png`, `remote-desktop.png`).
- 9:16 Hyperframes composition in `brag-output/composition/` orchestrating 6 acts with Iris accents, floating workbench panels, and music-synced timing.
- High-quality MP4 render with FFmpeg frame 0 poster baking and README showcase integration.

**Tech Stack:** 
- Hyperframes CLI (`v0.8.46`), Headless Chromium (`chrome-headless-shell`), FFmpeg 9.0+, Node.js 22+, HTML5, CSS3, SVG, Canvas.

**Spec:** [`docs/superpowers/specs/2026-09-18-betweenus-video-and-screenshots-design.md`](file:///D:/VS-Code/AI%20Expermients/Betweenus/docs/superpowers/specs/2026-09-18-betweenus-video-and-screenshots-design.md)

## Global Constraints
- Target video format: `1080 × 1920` (9:16 vertical), 30 fps, duration 29.5s.
- Color palette: Ground `#0b0f19`, Surface `#111827`/`#1f2937`, Iris Accent `#6366f1`/`#818cf8`, Hairline border `rgba(255, 255, 255, 0.08)`.
- Audio: Music Only (`happy-beats-business-moves-vol-1-by-ende-dot-app.mp3`) with 1.0s intro fade and 2.0s outro fade. No synthetic voiceover or sound effects.
- Output paths: `brag-output/brag.mp4`, `brag-output/brag.jpg`, `brag-output/share-copy.txt`, `pictures/home.png`, `pictures/home-android.png`, `pictures/voice-listen-play.png`, `pictures/moments-viewer.png`, `pictures/remote-desktop.png`.
- Git rule: All commits are strictly LOCAL. Never execute `git push`.

---

### Task 1: Generate High-Resolution Desktop Workbench Hero Screenshot (`pictures/home.png`)

**Files:**
- Create: `scripts/generate-screenshots.mjs`
- Create/Overwrite: `pictures/home.png`

**Interfaces:**
- Produces: `pictures/home.png` at `2560 × 1440` resolution representing the populated desktop workbench.

- [ ] **Step 1: Write screenshot rendering script template for Desktop Workbench**
Write a Node.js script `scripts/generate-screenshots.mjs` using Puppeteer / Playwright / headless Chrome to render a full-fidelity HTML template of the BetweenUs Desktop Workbench:
- Server rail on the left with Iris BetweenUs logo and notification badges.
- Channel list with `#general`, `#dev-chat`, `🔊 Lounge [3/8]`, and direct messages with presence indicators.
- Chat surface with rich conversation (`aiyu`, `alex`, `sophia`), syntax-highlighted TypeScript code block, E2EE verification pill (`AES-256-GCM sealed`), and reaction chips (`🔥 5`, `🚀 3`, `🛡️ 2`).
- Voice bar with connected peers and YouTube Listen Together mini-player.
- Bottom composer with markdown bar and encrypted send button.

- [ ] **Step 2: Run script to generate `pictures/home.png`**
Run: `node scripts/generate-screenshots.mjs --target home`
Verify: `pictures/home.png` is generated with non-zero size.

- [ ] **Step 3: Verify image resolution and visual fidelity**
Run: `ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 pictures/home.png`
Expected: `2560,1440`

- [ ] **Step 4: Commit**
```bash
git add pictures/home.png scripts/generate-screenshots.mjs
git commit -m "chore(assets): generate high-resolution desktop workbench hero screenshot"
```

---

### Task 2: Generate High-Resolution Android Mobile Showcase Screenshot (`pictures/home-android.png`)

**Files:**
- Modify: `scripts/generate-screenshots.mjs`
- Create: `pictures/home-android.png`

**Interfaces:**
- Produces: `pictures/home-android.png` at `1080 × 2400` resolution inside a modern bezel-less smartphone chassis.

- [ ] **Step 1: Add Android Compose Client template to `generate-screenshots.mjs`**
Add an HTML template with modern Android smartphone chassis (thin borders, camera punch-hole, status bar with clock and Wi-Fi):
- Top bar with server name, channel `#general`, and call status banner.
- Jetpack Compose Material 3 style chat bubbles with E2EE shield indicators.
- Avatars with segmented glowing rings indicating unwatched Moments stories.
- WhatsApp-style bottom media sheet with gallery thumbnails and camera button.

- [ ] **Step 2: Run script to generate `pictures/home-android.png`**
Run: `node scripts/generate-screenshots.mjs --target android`
Verify: `pictures/home-android.png` is generated with non-zero size.

- [ ] **Step 3: Verify image resolution**
Run: `ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 pictures/home-android.png`
Expected: `1080,2400`

- [ ] **Step 4: Commit**
```bash
git add pictures/home-android.png scripts/generate-screenshots.mjs
git commit -m "chore(assets): generate native android compose mobile showcase screenshot"
```

---

### Task 3: Generate Feature Deep-Dive Screenshots (Voice, Moments, Remote Desktop)

**Files:**
- Modify: `scripts/generate-screenshots.mjs`
- Create: `pictures/voice-listen-play.png`
- Create: `pictures/moments-viewer.png`
- Create: `pictures/remote-desktop.png`

**Interfaces:**
- Produces:
  - `pictures/voice-listen-play.png` (`2560 × 1440`)
  - `pictures/moments-viewer.png` (`1080 × 1920`)
  - `pictures/remote-desktop.png` (`2560 × 1440`)

- [ ] **Step 1: Add templates for Voice+Activities, Moments, and Remote Desktop to script**
- `voice-listen-play`: 4 participant video tiles with emerald speaker halos, docked Listen Together YouTube synchronized queue, and active Carrom board game.
- `moments-viewer`: Full-screen 24-hour disappearing story player with segmented top progress bar, time left, encrypted recipient list (`Frozen for 5 friends`), and reply bar.
- `remote-desktop`: Outbound remote desktop management session showing workstation stream, latency HUD (`12ms`), zero-inbound-port badge, and remote mouse/keyboard control overlay.

- [ ] **Step 2: Run script to generate all three feature screenshots**
Run: `node scripts/generate-screenshots.mjs --target features`
Verify: All 3 files are created in `pictures/`.

- [ ] **Step 3: Verify resolutions of all three images**
Run:
```bash
ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 pictures/voice-listen-play.png
ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 pictures/moments-viewer.png
ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 pictures/remote-desktop.png
```
Expected:
`2560,1440`
`1080,1920`
`2560,1440`

- [ ] **Step 4: Commit**
```bash
git add pictures/voice-listen-play.png pictures/moments-viewer.png pictures/remote-desktop.png scripts/generate-screenshots.mjs
git commit -m "chore(assets): generate voice, moments, and remote desktop screenshots"
```

---

### Task 4: Setup Brag Plan & Composition Brief

**Files:**
- Create: `brag-output/brag-plan.md`
- Create: `brag-output/composition-brief.md`

**Interfaces:**
- Consumes: Design spec from `docs/superpowers/specs/2026-09-18-betweenus-video-and-screenshots-design.md`
- Produces: Canonical planning documents for `/brag` and Hyperframes handoff.

- [ ] **Step 1: Write `brag-output/brag-plan.md`**
Answer all 9 questions from the `/brag` planning rubric:
1. What is the app?
2. What is the funniest or most impressive claim?
3. What is the visual hook?
4. What should be shown from the actual UI?
5. Shortest satisfying video?
6. Tone preset & creative direction: `polished`
7. Audio role: Music-only tech groove with smooth in/out fades.
8. Share caption draft.
9. User flow worth showing: 6 acts summing to 29.5s.

- [ ] **Step 2: Write `brag-output/composition-brief.md`**
Write the detailed Hyperframes handoff brief specifying dimensions (`1080x1920`), frame rate (30fps), asset locations, color tokens, and scene transitions.

- [ ] **Step 3: Verify file existence and duration sum**
Verify `brag-output/brag-plan.md` and `brag-output/composition-brief.md` exist and match the 29.5s duration requirement.

- [ ] **Step 4: Commit**
```bash
git add brag-output/brag-plan.md brag-output/composition-brief.md
git commit -m "docs(brag): add brag plan and composition brief for 9:16 vertical video"
```

---

### Task 5: Scaffold & Build Hyperframes 9:16 Video Composition

**Files:**
- Create: `brag-output/composition/hyperframes.json`
- Create: `brag-output/composition/index.html`
- Create: `brag-output/composition/styles.css`
- Copy: `brag-output/composition/assets/music/track.mp3`

**Interfaces:**
- Consumes: Music track from `.agents/skills/brag/assets/music/happy-beats-business-moves-vol-1-by-ende-dot-app.mp3`
- Produces: Fully functional Hyperframes project passing `npx hyperframes check`.

- [ ] **Step 1: Scaffold composition directory structure & copy music**
```bash
mkdir -p brag-output/composition/assets/music
cp .agents/skills/brag/assets/music/happy-beats-business-moves-vol-1-by-ende-dot-app.mp3 brag-output/composition/assets/music/track.mp3
```

- [ ] **Step 2: Create `brag-output/composition/hyperframes.json`**
Configure width: 1080, height: 1920, fps: 30, duration: 29.5.

- [ ] **Step 3: Implement `brag-output/composition/index.html` with 6 interactive acts**
Implement the 6 acts using CSS animations with data-timing attributes:
- Act 1 (0.0s – 4.0s): Kinetic typography hook + glowing AES-256-GCM shield.
- Act 2 (4.0s – 9.0s): Floating Desktop Workbench with live typing, code card, and reaction chips.
- Act 3 (9.0s – 14.0s): P2P WebRTC Voice Grid with speaking halos and latency meter.
- Act 4 (14.0s – 19.5s): Listen Together YouTube queue + Play Together Carrom board game.
- Act 5 (19.5s – 25.0s): 24h E2EE Moments story player + Outbound Remote Desktop session.
- Act 6 (25.0s – 29.5s): Converging cross-platform device cards, gleaming logo, settled poster frame.

- [ ] **Step 4: Run `npx hyperframes check` inside `brag-output/composition/`**
Run:
```bash
cd brag-output/composition
npx hyperframes check
```
Expected: PASS with 0 errors.

- [ ] **Step 5: Commit**
```bash
git add brag-output/composition/
git commit -m "feat(video): implement 9:16 hyperframes composition for betweenus"
```

---

### Task 6: Render 9:16 Video, Extract Best Poster Frame, and Bake Frame 0

**Files:**
- Create: `brag-output/brag.mp4`
- Create: `brag-output/brag.jpg`
- Copy: `video.mp4` (update root demo video)

**Interfaces:**
- Produces: Final rendered 1080x1920 MP4 video with embedded audio and frame 0 poster thumbnail.

- [ ] **Step 1: Render video using Hyperframes**
Run:
```bash
cd brag-output/composition
npx hyperframes render --quality high --output ../brag.mp4
```
Verify: `brag-output/brag.mp4` exists.

- [ ] **Step 2: Extract settled poster frame at 28.0s**
Run:
```bash
ffmpeg -ss 28.0 -i brag-output/brag.mp4 -frames:v 1 -q:v 2 brag-output/brag.jpg
```
Verify: `brag-output/brag.jpg` exists and resolution is `1080 × 1920`.

- [ ] **Step 3: Bake poster as Frame 0**
Run:
```bash
ffmpeg -y -i brag-output/brag.mp4 -i brag-output/brag.jpg -filter_complex "[0:v][1:v]overlay=0:0:enable='eq(n,0)'[v]" -map "[v]" -map 0:a? -c:v libx264 -crf 18 -preset slow -pix_fmt yuv420p -c:a copy -movflags +faststart brag-output/brag.poster.mp4 && mv brag-output/brag.poster.mp4 brag-output/brag.mp4
```

- [ ] **Step 4: Verify video stream properties with ffprobe**
Run:
```bash
ffprobe -v error -select_streams v:0 -show_entries stream=width,height,duration -of csv=p=0 brag-output/brag.mp4
```
Expected: `1080,1920,29.500000` (or approx 29.5s).

- [ ] **Step 5: Commit**
```bash
git add brag-output/brag.mp4 brag-output/brag.jpg
git commit -m "feat(video): render 9:16 showcase video with baked poster frame 0"
```

---

### Task 7: Generate Share Copy & Update Repository Showcase

**Files:**
- Create: `brag-output/share-copy.txt`
- Modify: `README.md:1-60`

**Interfaces:**
- Produces: Launch share copy and updated root README links.

- [ ] **Step 1: Write `brag-output/share-copy.txt`**
Draft postable launch copy for X/Twitter, LinkedIn, and Discord highlighting:
- True E2EE (AES-256-GCM, zero server decryption).
- Pure WebRTC P2P Voice/Video mesh (zero media server).
- Listen Together (YouTube sync) & Play Together (in-call board games).
- Outbound Remote Desktop & 24h Moments.
- Native Desktop (Electron), Web (React), and Native Android (Jetpack Compose).

- [ ] **Step 2: Update `README.md` hero image & preview links**
Update `README.md`:
- Hero banner referencing `pictures/home.png` and `brag-output/brag.mp4`.
- Add links to the new feature screenshot suite (`pictures/voice-listen-play.png`, `pictures/home-android.png`, etc.).

- [ ] **Step 3: Commit**
```bash
git add brag-output/share-copy.txt README.md
git commit -m "docs: update readme with high-resolution screenshots and 9:16 showcase video"
```
