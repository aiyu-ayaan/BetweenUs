# Mobile Web Responsive UI Adaptation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the BetweenUs web client adapt smoothly to mobile web screens (< 768px) with an Android-style sliding drawer menu, mobile headers with hamburger toggle, slide-over panels for members/search/pins, and responsive full-screen views.

**Architecture:** 
- Implement responsive viewport detection via a reactive `useIsMobile()` hook and dynamic `100dvh` layout wrappers.
- On viewports `< 768px`, replace the multi-column side-by-side desktop workbench with a full-width chat/active screen, folding the ServerRail and Channel/DM list into an Android-style sliding `MobileDrawer`.
- Wrap secondary panels (Member list, Pinned messages, Search) in right-hand slide-over sheets with touch dismissals on mobile.
- Refactor settings, friends, voice calls, and modal dialogs to scale to 100% width with touch-friendly targets and safe area insets.

**Tech Stack:** React 18, TypeScript, Tailwind CSS, Zustand, Vite.

## Global Constraints

- Preserve complete compatibility with the Electron desktop app (`apps/desktop`).
- Retain existing store architectures (`useChatStore`, `useAuthStore`, `usePresenceStore`, `useVoiceStore`, `useRemoteStore`).
- Zero horizontal layout overflow on mobile screens (`overflow-x-hidden`, `max-w-full`).
- Minimum 44x44px touch targets on mobile interactions.
- Dynamic viewport height support (`100dvh` / `h-screen`) to prevent mobile address bar clipping.

---

### Task 1: Responsive Hooks & Layout Utilities

**Files:**
- Create: `apps/desktop/src/services/responsive.ts`
- Create: `apps/desktop/src/services/responsive.check.ts`

**Interfaces:**
- Consumes: Standard DOM `window.matchMedia` and React hooks.
- Produces:
  - `MOBILE_BREAKPOINT = 768` (number)
  - `useIsMobile(): boolean`
  - `isMobileScreen(): boolean`
  - `isTouchDevice(): boolean`

- [ ] **Step 1: Write the failing test check for responsive utilities**

```typescript
// apps/desktop/src/services/responsive.check.ts
import assert from 'node:assert/strict';
import { MOBILE_BREAKPOINT, isMobileScreen } from './responsive';

assert.equal(MOBILE_BREAKPOINT, 768, 'Mobile breakpoint should be 768px');

// In node environment without window, isMobileScreen should safely return false without throwing
assert.equal(typeof isMobileScreen(), 'boolean');

console.log('responsive.check.ts ok');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @betweenus/desktop exec tsx src/services/responsive.check.ts`  
Expected: FAIL (cannot find module `./responsive`)

- [ ] **Step 3: Implement responsive utility functions and hook**

```typescript
// apps/desktop/src/services/responsive.ts
import { useEffect, useState } from 'react';

export const MOBILE_BREAKPOINT = 768;

export function isMobileScreen(): boolean {
  if (typeof window === 'undefined') return false;
  return window.innerWidth < MOBILE_BREAKPOINT;
}

export function isTouchDevice(): boolean {
  if (typeof window === 'undefined') return false;
  return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
}

export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState<boolean>(() => isMobileScreen());

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const media = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const update = (e: MediaQueryListEvent | MediaQueryList): void => {
      setIsMobile(e.matches);
    };

    update(media);

    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', update);
      return () => media.removeEventListener('change', update);
    } else if (typeof media.addListener === 'function') {
      media.addListener(update);
      return () => media.removeListener(update);
    }
  }, []);

  return isMobile;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @betweenus/desktop exec tsx src/services/responsive.check.ts`  
Expected: PASS (`responsive.check.ts ok`)

- [ ] **Step 5: Commit staged changes**

```bash
git add apps/desktop/src/services/responsive.ts apps/desktop/src/services/responsive.check.ts
git commit -m "feat(web): add responsive hooks and breakpoint utilities"
```

---

### Task 2: Android-Style Left Navigation Drawer (`MobileDrawer`)

**Files:**
- Create: `apps/desktop/src/features/shell/MobileDrawer.tsx`
- Modify: `apps/desktop/src/features/servers/ServerRail.tsx`

**Interfaces:**
- Consumes: `useChatStore`, `useAuthStore`, `usePresenceStore`, `HomeSidebar`, `ChannelSidebar`.
- Produces:
  - `<MobileDrawer open={boolean} onClose={() => void} onOpenUserSettings={() => void} onOpenServerSettings={() => void} onShowFriends={() => void} onShowRemote={() => void} />`

- [ ] **Step 1: Create `MobileDrawer.tsx` mirroring Android's `WorkspaceDrawer`**

The drawer renders a 2-column slide-out menu:
1. Left rail (~64px): DM/Home icon, Server icons with unread badges, Create/Join Server `(+)`, and Remote button.
2. Right channel/DM column (flex-1): Server header / DM header, text and voice channels, user profile bar at bottom with settings gear.
3. Backdrop overlay that dismisses drawer when tapped.

```tsx
// apps/desktop/src/features/shell/MobileDrawer.tsx
import { useEffect, useRef } from 'react';
import { useChatStore } from '../../stores/chat';
import { useAuthStore } from '../../stores/auth';
import { ServerRail } from '../servers/ServerRail';
import { ChannelSidebar } from '../channels/ChannelSidebar';
import { HomeSidebar } from '../home/HomeSidebar';

export function MobileDrawer({
  open,
  onClose,
  onOpenUserSettings,
  onOpenServerSettings,
  onShowFriends,
  onShowRemote,
  showingFriends,
  showingRemote,
}: {
  open: boolean;
  onClose: () => void;
  onOpenUserSettings: () => void;
  onOpenServerSettings: () => void;
  onShowFriends: () => void;
  onShowRemote: () => void;
  showingFriends: boolean;
  showingRemote: boolean;
}): JSX.Element {
  const view = useChatStore((state) => state.view);
  const activeChannelId = useChatStore((state) => state.activeChannelId);
  const prevChannelRef = useRef(activeChannelId);

  // Automatically close drawer when a channel is selected
  useEffect(() => {
    if (open && activeChannelId && activeChannelId !== prevChannelRef.current) {
      onClose();
    }
    prevChannelRef.current = activeChannelId;
  }, [activeChannelId, open, onClose]);

  // Lock body scroll while mobile drawer is open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = '';
      };
    }
  }, [open]);

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        aria-hidden="true"
        className={`fixed inset-0 z-40 bg-black/60 backdrop-blur-sm transition-opacity duration-300 ${
          open ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      />

      {/* Sliding Sheet (Rail + Sidebar) */}
      <div
        role="dialog"
        aria-label="Navigation drawer"
        aria-modal="true"
        className={`fixed inset-y-0 left-0 z-50 flex w-[320px] max-w-[85vw] bg-ground shadow-2xl transition-transform duration-300 ease-out ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex h-full w-full gap-1.5 p-1.5">
          {/* Server Rail */}
          <ServerRail />

          {/* Channels / Home Sidebar */}
          <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-edge bg-surface-900/95">
            {view === 'home' ? (
              <HomeSidebar
                showingFriends={showingFriends}
                onShowFriends={() => {
                  onShowFriends();
                  onClose();
                }}
                showingRemote={showingRemote}
                onShowRemote={() => {
                  onShowRemote();
                  onClose();
                }}
                onOpenUserSettings={() => {
                  onOpenUserSettings();
                  onClose();
                }}
              />
            ) : (
              <ChannelSidebar
                onOpenUserSettings={() => {
                  onOpenUserSettings();
                  onClose();
                }}
                onOpenServerSettings={() => {
                  onOpenServerSettings();
                  onClose();
                }}
              />
            )}
          </div>
        </div>
      </div>
    </>
  );
}
```

- [ ] **Step 2: Verify `ServerRail.tsx` styling for mobile drawer compatibility**

Ensure `ServerRail` fits comfortably inside the mobile drawer without causing extra scrollbars or clipping.

- [ ] **Step 3: Run build check**

Run: `pnpm --filter @betweenus/desktop build`  
Expected: PASS

- [ ] **Step 4: Commit staged changes**

```bash
git add apps/desktop/src/features/shell/MobileDrawer.tsx
git commit -m "feat(web): create android-style workspace navigation drawer"
```

---

### Task 3: Mobile Header & Hamburger Navigation Integration

**Files:**
- Modify: `apps/desktop/src/features/shell/TopBar.tsx`
- Modify: `apps/desktop/src/features/chat/ChatView.tsx`
- Modify: `apps/desktop/src/components/icons.tsx` (ensure MenuIcon is available)

**Interfaces:**
- Consumes: `useIsMobile`, `useChatStore`.
- Produces:
  - TopBar with responsive mobile layout / hamburger trigger.
  - ChatView header with hamburger button on mobile, channel title, call button, search/pins/members actions.

- [ ] **Step 1: Ensure `MenuIcon` / hamburger icon is exported in `icons.tsx`**

Check and add `MenuIcon` (`<svg>` with 3 horizontal lines) if not already present.

- [ ] **Step 2: Update `TopBar.tsx` to adapt responsively**

On mobile viewports (`md:hidden`), `TopBar` renders a simplified top bar with hamburger menu, active location title, and quick switcher button.

- [ ] **Step 3: Update `ChatView.tsx` header for mobile**

In `ChatView.tsx`:
- Accept `onOpenMenu?: () => void` prop.
- When on mobile, show the hamburger button `[☰]` at the left of the header.
- Allow tapping the title or header buttons with touch-friendly 44px hit areas.
- Make the composer bar fit responsive mobile widths (`w-full`, padding adjusted, touch-friendly send and emoji buttons).

- [ ] **Step 4: Run build check**

Run: `pnpm --filter @betweenus/desktop build`  
Expected: PASS

- [ ] **Step 5: Commit staged changes**

```bash
git add apps/desktop/src/features/shell/TopBar.tsx apps/desktop/src/features/chat/ChatView.tsx apps/desktop/src/components/icons.tsx
git commit -m "feat(web): add mobile header and hamburger navigation toggle"
```

---

### Task 4: Right-Hand Slide-Over Sheet Panels (`MemberList`, `PinnedPanel`, `SearchPanel`)

**Files:**
- Modify: `apps/desktop/src/App.tsx`
- Modify: `apps/desktop/src/features/members/MemberList.tsx`
- Modify: `apps/desktop/src/features/chat/PinnedPanel.tsx`
- Modify: `apps/desktop/src/features/chat/SearchPanel.tsx`

**Interfaces:**
- Consumes: `useIsMobile`, `rightPanel` from `useChatStore`.
- Produces:
  - Slide-over right drawer on mobile (`< 768px`) for right panels with header close button and backdrop.

- [ ] **Step 1: Create a responsive Sheet wrapper in `App.tsx` or `RightSheet.tsx`**

When `isMobile` is true and a right panel is active (`members`, `pins`, or `search`), display it as a slide-over sheet from the right edge with a backdrop:

```tsx
{isMobile && isRightPanelOpen && (
  <>
    <div
      onClick={() => closeRightPanel()}
      className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
      aria-hidden="true"
    />
    <div className="fixed inset-y-0 right-0 z-50 flex w-[300px] max-w-[85vw] flex-col bg-surface-900 border-l border-edge shadow-2xl transition-transform duration-300 ease-out translate-x-0">
      <div className="flex items-center justify-between border-b border-edge px-4 py-3">
        <h3 className="text-sm font-semibold text-slate-200">
          {rightPanel === 'members' ? 'Members' : rightPanel === 'pins' ? 'Pinned Messages' : 'Search'}
        </h3>
        <button
          onClick={() => closeRightPanel()}
          className="rounded-md p-1.5 text-slate-400 hover:bg-white/10 hover:text-slate-200"
        >
          <XIcon className="h-4 w-4" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {rightPanel === 'pins' && <PinnedPanel />}
        {rightPanel === 'search' && <SearchPanel />}
        {rightPanel === 'members' && <MemberList />}
      </div>
    </div>
  </>
)}
```

- [ ] **Step 2: Update `MemberList.tsx`, `PinnedPanel.tsx`, `SearchPanel.tsx` for responsive flex sizing**

Ensure headers and list rows in each right-side panel handle both desktop column mode and mobile sheet mode without fixed-width clipping.

- [ ] **Step 3: Run build check**

Run: `pnpm --filter @betweenus/desktop build`  
Expected: PASS

- [ ] **Step 4: Commit staged changes**

```bash
git add apps/desktop/src/App.tsx apps/desktop/src/features/members/MemberList.tsx apps/desktop/src/features/chat/PinnedPanel.tsx apps/desktop/src/features/chat/SearchPanel.tsx
git commit -m "feat(web): convert right panels to mobile slide-over sheets"
```

---

### Task 5: Mobile Viewport Height, CSS Layout, and Full-Screen Views

**Files:**
- Modify: `apps/desktop/src/App.tsx`
- Modify: `apps/desktop/src/index.css`
- Modify: `apps/web/index.html`
- Modify: `apps/desktop/src/features/home/FriendsView.tsx`
- Modify: `apps/desktop/src/features/settings/UserSettings.tsx`
- Modify: `apps/desktop/src/features/servers/ServerSettings.tsx`
- Modify: `apps/desktop/src/features/voice/VoiceChannelView.tsx`
- Modify: `apps/desktop/src/features/shell/QuickSwitcher.tsx`

**Interfaces:**
- Consumes: `useIsMobile`, `useChatStore`, `useVoiceStore`, `useAuthStore`.
- Produces:
  - Full mobile screen responsiveness across all views and dialogs.

- [ ] **Step 1: Update viewport height in `index.html` and `index.css`**

- Add `viewport-fit=cover` and dynamic viewport utility classes:
  ```html
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover" />
  ```
- Support `h-[100dvh]` on root and `Workbench` wrapper in `App.tsx`.

- [ ] **Step 2: Update `FriendsView.tsx` with mobile hamburger button and responsive tabs**

- When `isMobile` is true, display the hamburger button in the `FriendsView` header to open the `MobileDrawer`.
- Allow friend tabs (Online, All, Pending, Blocked, Add Friend) to scroll horizontally if needed without wrapping awkwardly.

- [ ] **Step 3: Update `UserSettings.tsx` and `ServerSettings.tsx` for mobile full-screen**

- On mobile screens (`< 768px`), display settings as full-screen pages with a sticky top bar and back button `[← Back]`, single-column navigation, and safe padding.

- [ ] **Step 4: Update `VoiceChannelView.tsx` and `QuickSwitcher.tsx` for mobile screens**

- `VoiceChannelView`: Adapt participant tile grid from multi-column to responsive 1-2 column grid with touch-friendly bottom control bar.
- `QuickSwitcher`: Full-width mobile modal with touchable row items.

- [ ] **Step 5: Run build check**

Run: `pnpm --filter @betweenus/desktop build` && `pnpm --filter @betweenus/web build`  
Expected: PASS

- [ ] **Step 6: Commit staged changes**

```bash
git add apps/desktop/src/App.tsx apps/desktop/src/index.css apps/web/index.html apps/desktop/src/features/home/FriendsView.tsx apps/desktop/src/features/settings/UserSettings.tsx apps/desktop/src/features/servers/ServerSettings.tsx apps/desktop/src/features/voice/VoiceChannelView.tsx apps/desktop/src/features/shell/QuickSwitcher.tsx
git commit -m "feat(web): optimize full-screen views, settings, and voice for mobile viewports"
```

---

### Task 6: Workspace Build, Typecheck, and Test Verification

**Files:**
- All touched files.

- [ ] **Step 1: Run all check suites**

Run: `pnpm --filter @betweenus/desktop run check`  
Expected: PASS for all check scripts including `responsive.check.ts`.

- [ ] **Step 2: Run typecheck across entire monorepo**

Run: `pnpm typecheck`  
Expected: PASS with 0 TypeScript errors.

- [ ] **Step 3: Run web production build**

Run: `pnpm --filter @betweenus/web build`  
Expected: PASS (Vite build outputs to `dist/`).

- [ ] **Step 4: Run desktop build**

Run: `pnpm --filter @betweenus/desktop build`  
Expected: PASS.

- [ ] **Step 5: Final review and commit if needed**

```bash
git status
```
