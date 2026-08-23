# Responsive Mobile Web UI Adaptation Design Specification

**Date:** 2026-08-23  
**Status:** Approved by User  
**Target:** Web UI Client (`apps/web` & `apps/desktop/src`)

---

## 1. Objective & Background

BetweenUs currently provides Web, Desktop, and Android clients. The Web client mounts the React workbench UI from `apps/desktop/src`. On desktop screens, this UI displays multiple floating card panels side-by-side (`ServerRail`, `ChannelSidebar` / `HomeSidebar`, `ChatView` / `FriendsView`, and `MemberList` / `PinnedPanel`).

On mobile web browsers (e.g. Chrome/Safari on Android or iOS mobile devices), these side-by-side columns overflow horizontally, making the interface unusable on small screens. The goal is to make the web version properly adapt to mobile screens, mirroring the Android app's layout architecture:
1. **Left Navigation Drawer (`MobileDrawer` / `WorkspaceDrawer`):** A slide-over drawer combining the Server Rail and Channels/DM list with smooth backdrop overlay and auto-dismiss on navigation.
2. **Mobile Header with Hamburger Menu:** Full-width conversation view with `[☰]` button to open the navigation drawer.
3. **Right Slide-over Sheets:** Member list, search, and pinned panels open as right slide-over drawers on mobile screens instead of shrinking the chat column.
4. **Full-screen Responsive Overlays:** User settings, server settings, friend views, and quick switcher scale cleanly to full viewport on mobile.
5. **Mobile Viewport & Touch Optimization:** Dynamic viewport height (`100dvh`), minimum 44px touch targets, and prevention of horizontal overflow.

---

## 2. Architecture & Breakpoint Strategy

### 2.1 Viewport Breakpoint Detection
* **`useIsMobile` hook:**
  * Uses `window.matchMedia('(max-width: 767px)')` with real-time change listeners.
  * Ensures seamless reactivity on resize, rotation, or orientation change.
  * Desktop layout is preserved whenever `window.innerWidth >= 768px`.

### 2.2 Mobile Viewport Heights
* Uses `100dvh` (`h-[100dvh]` / `h-screen`) on the outer wrapper so mobile browser address bars and virtual keyboards don't break the bottom composer bar.
* Sets `overflow-x-hidden` on all parent containers to eliminate horizontal page scrolling.

---

## 3. Detailed Component Specifications

### 3.1 Left Mobile Drawer (`MobileDrawer`)
* **Trigger:** Hamburger button in the mobile TopBar or chat header; also support manual drawer state via `drawerOpen`.
* **Visual Structure (matches Android `WorkspaceDrawer`):**
  * **Left Rail (~64-68px wide):**
    * DM / Home icon button.
    * Server icons with unread badges and active server indicator.
    * Add server button `(+)`.
    * Remote machines button.
  * **Right Sidebar Column (flex-1):**
    * Header: Server name (or "Direct messages") + Server settings / Invite button (for servers).
    * Channel List: Text channels and Voice channels (with voice participant counts and voice members), or Direct message list when in Home view.
    * Bottom User Status Bar: User avatar with status indicator, display name & username, and Settings gear icon.
* **Dismiss Behavior:**
  * Selecting a channel/DM automatically closes the drawer.
  * Tapping the darkened backdrop closes the drawer.
  * Smooth CSS translate-x animation (`transition-transform duration-250 ease-out`).

### 3.2 Mobile TopBar & Headers
* **Desktop TopBar (`md:flex`):** Retains centered quick switcher / search bar and desktop layout toggles.
* **Mobile Header (`md:hidden`):**
  * Left: Hamburger menu button `[☰]` (toggles `MobileDrawer`).
  * Center: Active channel name (`# channel-name` or DM recipient) + server name or status.
  * Right: Voice call button `[📞]`, Pinned messages `[📌]`, Search `[🔍]`, Members list toggle `[👥]`.

### 3.3 Right Panel Slide-over Sheets (`MemberList`, `PinnedPanel`, `SearchPanel`)
* On desktop (`md:block`), these render as adjacent right-hand panels.
* On mobile (`< 768px`):
  * Rendered as an absolute / fixed slide-over sheet from the right edge with a backdrop.
  * Includes a header with title and close button `[✕]`.
  * Allows user to view member profiles, search channel messages, or inspect pinned messages without disrupting chat layout.

### 3.4 Full-screen Settings & Views
* **`UserSettings` & `ServerSettings`:** Full-screen overlay on mobile (`w-full h-full`) with a top header containing a back/close button, smooth vertical scroll, and touch-sized buttons.
* **`FriendsView` & `RemoteView`:** Single-column layout on mobile, full width with top navigation and action tabs.
* **`QuickSwitcher`:** Mobile-friendly modal with top-safe margins, auto-focused search input, and large touchable search results.

---

## 4. Staged Git Commits Plan

To ensure clean, verifiable milestones:
1. **Stage 1:** Add responsive utilities (`useIsMobile`), viewport CSS adjustments (`100dvh`), and mobile navigation drawer components.
2. **Stage 2:** Integrate `MobileDrawer` into `Workbench` / `App.tsx` and adapt `TopBar` / `ChatView` header with mobile hamburger button and right action triggers.
3. **Stage 3:** Adapt right-hand panels (`MemberList`, `PinnedPanel`, `SearchPanel`) into slide-over sheets on mobile.
4. **Stage 4:** Optimize `FriendsView`, `UserSettings`, `ServerSettings`, and `VoiceChannelView` for mobile screen responsiveness.
5. **Stage 5:** End-to-end verification and UI polish.

---

## 5. Verification & Testing

* **Build & Typecheck:** Run `pnpm --filter @betweenus/web build` and `pnpm --filter @betweenus/desktop build` to ensure type safety and bundling pass.
* **Responsive Breakpoint Verification:** Test UI at:
  * Mobile portrait: `375px × 667px` (iPhone SE) and `390px × 844px` (iPhone 12/13/14).
  * Mobile landscape / small tablet: `600px × 800px`.
  * Desktop: `1024px+` and `1440px+`.
* **Drawer & Sheet Interactions:**
  * Open left drawer via hamburger menu -> switch server -> select channel -> verify drawer closes and selected channel loads.
  * Open right member list / pins / search -> verify slide-over overlay -> close -> return to chat.
  * Open settings -> verify full-screen mobile layout and back navigation.
