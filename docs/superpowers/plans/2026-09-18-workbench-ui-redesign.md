# Workbench UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Overhaul the BetweenUs desktop and web interface (TopBar, ServerRail, ChannelSidebar, ChatView, and Right-hand Activity & Member Panel) to match `pictures/home.png` with Emil Kowalski / Apple-grade motion animations.

**Architecture:** Refactor and upgrade the existing React client components in `apps/desktop/src` (which both Electron and Web runtimes mount). Enhance navigation, channels hierarchy, cryptographic chat cards, and right-hand activity widgets while adhering strictly to TypeScript strict mode (no `any`), centralized permissions, and GPU-accelerated motion standards.

**Tech Stack:** React 18, TypeScript 5.5, Tailwind CSS 3.4, Lucide SVG icons, Zustand stores.

**Spec:** [`docs/superpowers/specs/2026-09-18-workbench-ui-redesign-design.md`](file:///D:/VS-Code/AI%20Expermients/Betweenus/docs/superpowers/specs/2026-09-18-workbench-ui-redesign-design.md)

## Global Constraints

- **TypeScript Strict Mode**: Never commit `any`. Use strict types, discriminated unions, and typed props.
- **Attribution & Commits**: Follow conventional commit formats (`<type>(<scope>): <short summary>`). Never add AI assistant usernames as author or co-author. Commits must remain strictly local. NEVER execute `git push`.
- **Motion Principles**: Hardware-accelerated (`transform` and `opacity` only). Snappy 150–200ms `ease-out` curves, `active:scale-[0.97]` micro-press feedback. Support `prefers-reduced-motion`.
- **Runtime Compatibility**: Both Electron desktop and Vite web mount `apps/desktop/src/App.tsx`. All edits must cleanly support both environments.

---

### Task 1: Motion Tokens & Design Primitives

**Files:**
- Modify: `apps/desktop/src/components/icons.tsx`
- Modify: `apps/desktop/src/index.css`
- Create: `apps/desktop/src/components/icons.check.ts`

**Interfaces:**
- Produces:
  - `HeadphonesIcon`: `(props: SVGProps<SVGSVGElement>) => JSX.Element` in `icons.tsx`
  - CSS animation classes: `.animate-typing-dot`, `.animate-speaker-halo`, `.animate-pulse-subtle`, `.spring-press` in `index.css`

- [ ] **Step 1: Write self-check test for new icon and animation styles**

```typescript
// apps/desktop/src/components/icons.check.ts
import { HeadphonesIcon } from './icons';

export function testIcons(): void {
  if (typeof HeadphonesIcon !== 'function') {
    throw new Error('HeadphonesIcon must be exported as a React functional component');
  }
}

testIcons();
console.log('icons.check.ts passed');
```

- [ ] **Step 2: Add `HeadphonesIcon` to `icons.tsx`**

```tsx
export const HeadphonesIcon = (props: IconProps): JSX.Element => (
  <Base {...props}>
    <path d="M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3" />
  </Base>
);
```

- [ ] **Step 3: Add motion animation keyframes and utility classes to `index.css`**

Add hardware-accelerated animations for typing dots, speaker halos, and subtle pulses:
```css
@keyframes typing-bounce {
  0%, 80%, 100% {
    transform: translateY(0);
    opacity: 0.4;
  }
  40% {
    transform: translateY(-4px);
    opacity: 1;
  }
}

@keyframes speaker-pulse {
  0% {
    box-shadow: 0 0 0 0 rgba(63, 214, 140, 0.6);
  }
  70% {
    box-shadow: 0 0 0 6px rgba(63, 214, 140, 0);
  }
  100% {
    box-shadow: 0 0 0 0 rgba(63, 214, 140, 0);
  }
}

.animate-typing-dot {
  animation: typing-bounce 1.2s infinite ease-in-out;
}

.animate-speaker-halo {
  animation: speaker-pulse 2s infinite ease-in-out;
}

.spring-press {
  transition: transform 150ms cubic-bezier(0.16, 1, 0.3, 1), background-color 150ms ease-out;
}
.spring-press:active {
  transform: scale(0.97);
}

@media (prefers-reduced-motion: reduce) {
  .animate-typing-dot,
  .animate-speaker-halo,
  .spring-press {
    animation: none !important;
    transition: none !important;
  }
}
```

- [ ] **Step 4: Verify with tsx check and commit**

```bash
npx tsx apps/desktop/src/components/icons.check.ts
git add apps/desktop/src/components/icons.tsx apps/desktop/src/components/icons.check.ts apps/desktop/src/index.css
git commit -m "feat(ui): add headphones icon and motion animation tokens"
```

---

### Task 2: TopBar & ServerRail Navigation Redesign

**Files:**
- Modify: `apps/desktop/src/features/shell/TopBar.tsx`
- Modify: `apps/desktop/src/features/servers/ServerRail.tsx`

**Interfaces:**
- Consumes:
  - `BetweenUsLogoIcon`, `SearchIcon`, `BellIcon`, `SettingsIcon`, `MessageIcon`, `PlusIcon`, `CompassIcon` from `components/icons`
  - `useChatStore`, `useVoiceStore`
- Produces:
  - Updated `TopBar` with Workbench / Activities / Moments tabs, WebRTC mesh latency pill, notifications, and settings
  - Updated `ServerRail` with active BetweenUs HQ squircle icon, server unread badges, and action triggers

- [ ] **Step 1: Update `TopBar.tsx` with tabs, telemetry badge, and action triggers**

Update `TopBar.tsx`:
- Brand squircle with Iris `BetweenUsLogoIcon` and "BetweenUs" typography.
- Navigation switcher pills: `Workbench` (active with highlight), `Activities`, `Moments`.
- Center omnibar search pill: `🔍 BetweenUs HQ / #general` with `Ctrl K` badge.
- Telemetry badge: `● WebRTC Mesh • 14ms` with pulsing emerald dot.
- Notification bell and settings cog with smooth hover transitions.

- [ ] **Step 2: Update `ServerRail.tsx` with squircle BetweenUs HQ button and server badges**

Update `ServerRail.tsx`:
- Top active BetweenUs HQ squircle button (`h-11 w-11 rounded-2xl bg-accent text-white flex items-center justify-center shadow-lg shadow-accent/25`) with active white pill marker.
- Direct message bubble button.
- Server circles: BU, OS (with red badge `3`), RT, CG.
- Plus `+` button and Compass `🧭` explore button.
- Smooth transition curves between circle (`rounded-[22px]`) and squircle (`rounded-2xl`).

- [ ] **Step 3: Test and commit**

Run typecheck on desktop package:
```bash
npm --prefix apps/desktop run typecheck
git add apps/desktop/src/features/shell/TopBar.tsx apps/desktop/src/features/servers/ServerRail.tsx
git commit -m "feat(ui): redesign topbar navigation and server rail"
```

---

### Task 3: Channel Sidebar & Live Voice Presence

**Files:**
- Modify: `apps/desktop/src/features/channels/ChannelSidebar.tsx`
- Modify: `apps/desktop/src/features/settings/UserPanel.tsx`

**Interfaces:**
- Consumes:
  - `HeadphonesIcon`, `MicIcon`, `MicOffIcon`, `SettingsIcon`, `LockIcon`, `HashIcon`, `SpeakerIcon`
  - `useChatStore`, `useVoiceStore`, `usePresenceStore`, `useAuthStore`
- Produces:
  - Verified server header with `24 Online • E2EE Mesh`
  - Text channels with unread badges (`# releases` [1], `# engineering` [4], `# general` locked)
  - `🔊 Lounge [3/8]` with live speaking participant hierarchy (`aiyu (speaking)`, `alex (speaking)`, `sophia`)
  - Direct messages list with activity statuses
  - User panel with `Founder • Online` and mic/deafen/settings controls

- [ ] **Step 1: Update `ChannelSidebar.tsx`**

Implement:
- Server Header: "BetweenUs HQ" with verified badge and subtitle `24 Online • E2EE Mesh`.
- Text Channels: `# general` (active blue pill, lock icon), `# releases` (badge `1`), `# engineering` (badge `4`), `# architecture`, `# security-audits`.
- Voice Channels: `🔊 Lounge [3/8]` with expandable / rendered participant items:
  - `● aiyu (speaking)` with green dot and audio ring
  - `● alex (speaking)` with green dot and audio ring
  - `● sophia`
  - `🔊 Stage & Pair Prog`, `🔊 Daily Standup`.
- Direct Messages Section:
  - `aiyu` (Listening to Lofi Beats)
  - `alex` (In Lounge • Carrom match)
  - `sophia` (Reviewing benchmarks)
  - `marcus` (Testing WebRTC mesh)

- [ ] **Step 2: Update `UserPanel.tsx`**

Implement:
- User status: `Founder • Online` under display name.
- Three action controls: Microphone mute toggle, Headphone deafen toggle (`HeadphonesIcon`), and Settings gear.

- [ ] **Step 3: Test and commit**

```bash
npm --prefix apps/desktop run typecheck
git add apps/desktop/src/features/channels/ChannelSidebar.tsx apps/desktop/src/features/settings/UserPanel.tsx
git commit -m "feat(ui): overhaul channel sidebar with voice participant tree and user controls"
```

---

### Task 4: Cryptographic Chat Canvas & Rich Message Artifacts

**Files:**
- Modify: `apps/desktop/src/features/chat/ChatView.tsx`

**Interfaces:**
- Consumes:
  - `useChatStore`, `useAuthStore`
  - Syntax highlighting, code snippet card, attachment card, emoji reactions
- Produces:
  - Double Ratchet E2EE security banner
  - Channel welcome header
  - Role badges (`STAFF`, `CORE TEAM`, `FOUNDER`)
  - Interactive Code Snippet Card (`< > peer-connection.ts TypeScript`)
  - Verified E2EE PDF File Attachment Card with SHA256 checksum and download trigger
  - Interactive spring emoji reaction chips
  - Animated typing indicator (`••• sophia is typing...`)
  - Pill input dock with attachments, emoji, mic, and send button

- [ ] **Step 1: Implement E2EE banner, welcome header, and date separator in `ChatView.tsx`**

Render:
- Top banner: Shield icon with glowing blue tone: "All conversations and attachments in this channel are encrypted end-to-end with AES-256-GCM Double Ratchet. Ephemeral keys never touch the gateway."
- Welcome to #general card: Large `#` glyph in blue circle with description.
- Date separator: `TODAY — SEPTEMBER 18, 2026`.

- [ ] **Step 2: Implement role badges, code snippet box, and verified PDF file attachment card**

Render:
- User badges: `STAFF` (cyan), `CORE TEAM` (emerald), `FOUNDER` (iris).
- Code Snippet Box for code blocks:
  - Header: `< > peer-connection.ts` on left, `TypeScript` badge on right, copy button.
  - Formatted syntax-highlighted code block.
- File attachment card:
  - Document icon, `betweenus-e2ee-benchmarks-v2.4.pdf 🔒`.
  - `2.4 MB • SHA256: 8f4a2b ... d91c • Verified E2EE Payload`.
  - Glass `[↓ Download]` button.
- Spring emoji reactions (`👍 4`, `🚀 6`, `🔥 5`, `✨ 3`, `💜 2`, `🎉 7`, `💖 4`) with click bounce.

- [ ] **Step 3: Implement typing indicator and full-width pill input dock**

Render:
- Typing indicator with 3 bouncing dots: `••• sophia is typing...`.
- Chat input bar: Rounded dark pill container with paperclip, placeholder `Message #general (E2EE sealed)`, smiley, mic, and iris circular send button.

- [ ] **Step 4: Test and commit**

```bash
npm --prefix apps/desktop run typecheck
git add apps/desktop/src/features/chat/ChatView.tsx
git commit -m "feat(ui): add e2ee banners, code snippets, pdf cards, and spring reactions to chat view"
```

---

### Task 5: Composite Right Sidebar (Voice Lounge & Listen Together + Grouped Member List)

**Files:**
- Create: `apps/desktop/src/features/members/RightSidebar.tsx`
- Modify: `apps/desktop/src/App.tsx`

**Interfaces:**
- Consumes:
  - `useChatStore`, `useVoiceStore`, `usePresenceStore`
- Produces:
  - `RightSidebar`: Composite component combining Voice Lounge & Listen Together Player with Grouped Member List

- [ ] **Step 1: Create `RightSidebar.tsx`**

Implement:
- Fixed width right column (`w-72 border-s border-edge bg-surface-900/40 backdrop-blur-md`).
- Top Module: Voice Lounge Widget
  - Header: `🔊 Lounge`, badge: `● LIVE • 08:42` with emerald pulsing dot.
  - Active participant chips: `aiyu` (speaking halo), `alex` (speaking halo), `sophia` (muted).
  - Listen Together Synced Player:
    - Header: Red YouTube play icon, `Listen Together` title, `Audio Ducking Active` emerald badge.
    - Title: `Lofi Beats 24/7 — Chillhop Radio`, `Lofi Records • 3 listeners in sync`.
    - Progress scrubber: `1:42` [=======o-----------------] `3:30`.
    - Controls: Skip previous, Play/Pause circle (`⏸` white button with click spring), Skip next.
- Bottom Module: Grouped Member List
  - `CORE TEAM — 2`: aiyu (Crown `👑`, Founder • In Lounge), alex (Core Team • In Lounge).
  - `ENGINEERS — 4`: sophia (Staff Engineer • Away), marcus (Testing WebRTC mesh), elena (Writing Carrom physics), david (Electron runtime).
  - `ONLINE — 8`: chen (Playing Carrom), liam, zack, sarah (Reviewing PR #42), maya, vikram, tariq, noah.

- [ ] **Step 2: Update `App.tsx` to mount `RightSidebar` in server view**

Integrate `RightSidebar` into the desktop layout alongside `ChatView`.

- [ ] **Step 3: Test and commit**

```bash
npm --prefix apps/desktop run typecheck
git add apps/desktop/src/features/members/RightSidebar.tsx apps/desktop/src/App.tsx
git commit -m "feat(ui): add composite right sidebar with voice lounge, listen together, and member roster"
```

---

### Task 6: Full Verification, Clean Build, and Motion Polish

**Files:**
- Test all components across `apps/desktop` and `apps/web`

- [ ] **Step 1: Run typecheck across entire monorepo or desktop client**

Run: `npm --prefix apps/desktop run typecheck`
Expected: 0 errors

- [ ] **Step 2: Run build across desktop client**

Run: `npm --prefix apps/desktop run build`
Expected: Clean build output

- [ ] **Step 3: Verify strict guidelines and git status**

Confirm:
- Zero `any` types introduced.
- No `git push` executed.
- Clean local commit log.
