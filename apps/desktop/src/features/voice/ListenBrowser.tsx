/**
 * YouTube itself, inside the call. Press a video; the whole call watches it.
 *
 * The paste box was the first version and it was the wrong shape. Nobody keeps
 * a list of video ids; they search for a half-remembered chorus, or open the
 * playlist they made, or look at what their subscriptions posted this morning -
 * and every one of those needs the actual site and, for two of them, a signed-in
 * account.
 *
 * The second version was the right site with the wrong control: a button that
 * queued whatever page you were on. That is still a paste box - it just moved
 * the copying inside the app. Pressing play is the gesture people already have
 * for "play this", so that is the gesture that plays it: a thumbnail, the
 * player's own play button, whatever the page runs next. The page is stopped
 * and the call plays the same video where everybody can see it. The queue
 * button stays for the other thing, which is choosing what comes *after* what
 * is on.
 *
 * Like the player slot in `ListenPanel`, this component draws nothing. The page is a
 * `WebContentsView` the main process owns, and this hands it a rectangle to sit
 * over. That is not an implementation detail worth hiding: a view destroyed and
 * rebuilt on every React unmount would throw away the sign-in, the scroll
 * position and the search on every re-render, so the rule is that the view
 * outlives the component and the component only says where to put it.
 *
 * **Desktop only.** youtube.com sends `X-Frame-Options` and a `frame-ancestors`
 * policy, so no browser tab can ever show the site inside another page. The web
 * client gets the paste box, which is the honest version of that limit rather
 * than a broken frame.
 */
import { useEffect, useRef, useState } from 'react';
import { useListenStore } from '../../stores/listen';
import { isDesktopRuntime } from '../../services/platform';
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CompassIcon,
  PlusIcon,
  SearchIcon,
} from '../../components/icons';

interface Navigation {
  url: string;
  title: string;
  videoId: string | null;
  canGoBack: boolean;
  canGoForward: boolean;
  loading: boolean;
}

export function ListenBrowser(): JSX.Element {
  const slot = useRef<HTMLDivElement>(null);
  const [nav, setNav] = useState<Navigation | null>(null);
  const [query, setQuery] = useState('');
  const [added, setAdded] = useState<string | null>(null);

  const bridge = window.betweenus;

  // The rectangle, tracked the same way the player's frame is: on a frame loop,
  // because the box moves for reasons no observer reports - a sidebar opening,
  // a banner appearing above it, the window crossing to another monitor.
  useEffect(() => {
    if (!bridge?.youtubeOpen || !bridge.youtubeBounds) return undefined;
    let raf = 0;
    let last = '';

    const push = (): void => {
      const box = slot.current?.getBoundingClientRect();
      if (box && box.width > 0 && box.height > 0) {
        const key = `${box.left}:${box.top}:${box.width}:${box.height}`;
        // Only when it has moved: this runs sixty times a second and each call
        // is an IPC round trip into the main process.
        if (key !== last) {
          last = key;
          void bridge.youtubeBounds?.({ x: box.left, y: box.top, width: box.width, height: box.height });
        }
      }
      raf = requestAnimationFrame(push);
    };

    const box = slot.current?.getBoundingClientRect();
    void bridge.youtubeOpen({
      x: box?.left ?? 0,
      y: box?.top ?? 0,
      width: box?.width ?? 0,
      height: box?.height ?? 0,
    });
    raf = requestAnimationFrame(push);

    const stop = bridge.onYouTubeNavigated?.((state) => setNav(state));

    return () => {
      cancelAnimationFrame(raf);
      stop?.();
      // Hidden rather than closed: collapsing the panel must not cost the
      // sign-in, the search that was typed or the video half watched. The store
      // closes it for real when the call ends.
      void bridge.youtubeHide?.();
    };
  }, [bridge]);

  // Pressing play *is* the control - on a thumbnail, on the player's own play
  // button, on whatever the page decided to run next. The main process stops
  // the page and says which video was asked for; this plays it where the whole
  // call can see it and hands the panel back to the player.
  //
  // This used to watch for navigations instead, which is a proxy for the intent
  // and a poor one: it fired for a page opened to read the description, and
  // missed a play pressed on a page that was already open - which is exactly
  // the case that looked broken.
  useEffect(() => {
    if (!bridge?.onYouTubePlay) return undefined;
    return bridge.onYouTubePlay((videoId) => {
      const store = useListenStore.getState();
      const playing = store.session?.queue[store.session.index];
      // Already what the call is watching: show it rather than queueing a
      // second copy of the same video behind itself.
      if (playing?.ref !== videoId) store.add(videoId, true);
      store.setTab('playing');
    });
  }, [bridge]);

  if (!isDesktopRuntime() || !bridge?.youtubeOpen) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-white/10 p-6 text-center">
        <CompassIcon className="h-6 w-6 text-slate-700" />
        <p className="max-w-sm text-xs leading-relaxed text-slate-400">
          Browsing YouTube inside the app is desktop-only. youtube.com refuses to
          be shown inside another page - a rule the site sets, which a browser
          tab cannot get around - so paste a link instead. Everything else about
          listening together works exactly the same.
        </p>
      </div>
    );
  }

  const queue = (): void => {
    if (!nav?.videoId) return;
    useListenStore.getState().add(nav.videoId);
    setAdded(nav.videoId);
    window.setTimeout(() => setAdded(null), 1500);
    // Deliberately stays on the site: adding a second track while looking for a
    // third is the normal case, and being thrown back to the player every time
    // is what made queueing four songs annoying.
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex shrink-0 flex-wrap items-center gap-1">
        <ToolbarButton
          label="Back"
          disabled={!nav?.canGoBack}
          onClick={() => void bridge.youtubeBack?.()}
        >
          <ChevronLeftIcon className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton
          label="Forward"
          disabled={!nav?.canGoForward}
          onClick={() => void bridge.youtubeForward?.()}
        >
          <ChevronRightIcon className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton label="YouTube home" onClick={() => void bridge.youtubeHome?.()}>
          <CompassIcon className="h-4 w-4" />
        </ToolbarButton>

        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || !query.trim()) return;
            void bridge.youtubeSearch?.(query);
          }}
          placeholder="Search YouTube"
          aria-label="Search YouTube"
          className="min-w-0 flex-1 rounded-md border border-white/10 bg-surface-800 px-2 py-1.5 text-sm text-slate-200 placeholder:text-slate-500 focus:border-white/20 focus:outline-none"
        />
        <ToolbarButton
          label="Search"
          disabled={!query.trim()}
          onClick={() => void bridge.youtubeSearch?.(query)}
        >
          <SearchIcon className="h-4 w-4" />
        </ToolbarButton>

        {/* Not "play this" - pressing it on the site already did that. This is
            for building a queue *behind* what is on, which is the one thing
            clicking a thumbnail cannot say. Live only on a video page, because
            queueing "the YouTube home page" is not a thing. */}
        <button
          type="button"
          onClick={queue}
          disabled={!nav?.videoId}
          title={nav?.videoId ? 'Add this to the shared queue' : 'Open a video first'}
          className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md bg-amber-500/15 px-2.5 py-1.5 text-xs font-medium text-amber-200 transition-colors hover:bg-amber-500/25 disabled:cursor-not-allowed disabled:bg-surface-800 disabled:text-slate-600"
        >
          <PlusIcon className="h-3.5 w-3.5" />
          {added && added === nav?.videoId ? 'Added' : 'Add to queue'}
        </button>

      </div>

      {/* The slot. Empty on purpose - the page is a view the main process owns
          and positions over this rectangle, so unmounting cannot destroy it. */}
      <div ref={slot} className="min-h-0 flex-1 overflow-hidden rounded-lg bg-black" />

      <p className="shrink-0 truncate text-[11px] text-slate-600" title={nav?.url}>
        {nav?.loading ? 'Loading…' : (nav?.title ?? 'youtube.com')}
        {' · press play on anything and the whole call watches it. Nothing '}
        {'plays in here; the picture is the shared player’s. Signed in with '}
        {'your own Google account, kept apart from BetweenUs'}
      </p>
    </div>
  );
}

function ToolbarButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="flex shrink-0 items-center justify-center rounded-md bg-surface-800 p-1.5 text-slate-300 transition-colors hover:bg-white/[0.06] hover:text-slate-100 disabled:cursor-not-allowed disabled:text-slate-600 disabled:opacity-50"
    >
      {children}
    </button>
  );
}
