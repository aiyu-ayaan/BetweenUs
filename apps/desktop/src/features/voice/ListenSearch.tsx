/**
 * The web client's way in: search results instead of the site itself.
 *
 * The desktop app puts the actual youtube.com in the panel and lets people
 * press play on it. A browser tab cannot do that and never will - youtube.com
 * sends `X-Frame-Options` and a `frame-ancestors` policy, which is the site
 * saying no to being framed, and there is no flag, proxy or sandbox on this
 * side that overrules it.
 *
 * What was left was a paste box, which asks somebody to leave the app, find the
 * video somewhere else and copy a link back. This is the same gesture as the
 * desktop browser - look for a song, press it, the call watches it - reached
 * the only way a web page can reach it: the YouTube Data API, called from the
 * person's own browser, so the search goes to Google and never through
 * BetweenUs. See `services/youtube-search.ts` for why it is a browser key.
 *
 * The paste box has not gone anywhere. It is in `Queue` beside this panel, it
 * needs no key, and a pasted link typed in the box here is recognised as itself
 * rather than searched for.
 */
import { useEffect, useRef, useState } from 'react';
import { useListenStore } from '../../stores/listen';
import { parseYouTube } from '../../services/youtube';
import { searchYouTube, youtubeSearchKey, type YouTubeResult } from '../../services/youtube-search';
import { CompassIcon, PlusIcon, SearchIcon } from '../../components/icons';

export function ListenSearch(): JSX.Element {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<YouTubeResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [added, setAdded] = useState<string | null>(null);
  /** The search in flight, cancelled when a newer one starts or this unmounts. */
  const inFlight = useRef<AbortController | null>(null);

  useEffect(() => () => inFlight.current?.abort(), []);

  if (!youtubeSearchKey()) return <Unconfigured />;

  const run = (): void => {
    const text = query.trim();
    if (!text) return;

    // A pasted link is not a search. Somebody who has the URL already knows
    // exactly which video they mean, and spending a quota unit to look it up by
    // its own title would be both slower and worse.
    const pasted = parseYouTube(text);
    if (pasted) {
      play(pasted);
      setQuery('');
      return;
    }

    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    setSearching(true);
    setProblem(null);

    void searchYouTube(text, controller.signal)
      .then((found) => {
        if (controller.signal.aborted) return;
        setResults(found);
        if (found.length === 0) setProblem('Nothing found for that.');
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setProblem(error instanceof Error ? error.message : 'The search failed.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setSearching(false);
      });
  };

  /**
   * Pressing a result is "play this", the same as pressing a thumbnail on the
   * real site: the call moves to the video and the panel hands back to the
   * player, because the point of pressing it was to watch it.
   */
  const play = (videoId: string): void => {
    const store = useListenStore.getState();
    const playing = store.session?.queue[store.session.index];
    // Already on: show it rather than queueing a second copy behind itself.
    if (playing?.ref !== videoId) store.add(videoId, true);
    store.setTab('playing');
  };

  /** The other thing, which a thumbnail cannot say: play it *after* this one. */
  const queue = (videoId: string): void => {
    useListenStore.getState().add(videoId);
    setAdded(videoId);
    window.setTimeout(() => setAdded(null), 1500);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex shrink-0 items-center gap-1.5">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') run();
          }}
          placeholder="Search YouTube, or paste a link"
          aria-label="Search YouTube"
          className="min-w-0 flex-1 rounded-md border border-white/10 bg-surface-800 px-2 py-1.5 text-sm text-slate-200 placeholder:text-slate-500 focus:border-white/20 focus:outline-none"
        />
        <button
          type="button"
          onClick={run}
          disabled={!query.trim() || searching}
          aria-label="Search"
          title="Search"
          className="flex shrink-0 cursor-pointer items-center justify-center rounded-md bg-surface-800 p-2 text-slate-300 transition-colors hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <SearchIcon className="h-4 w-4" />
        </button>
      </div>

      {problem && <p className="shrink-0 text-xs text-red-400">{problem}</p>}

      {results.length === 0 ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-white/10 p-6 text-center">
          <CompassIcon className="h-6 w-6 text-slate-700" />
          <p className="max-w-sm text-xs leading-relaxed text-slate-400">
            {searching
              ? 'Searching…'
              : 'Search for something and press it - the whole call watches it, each from their own connection.'}
          </p>
        </div>
      ) : (
        <ul className="grid min-h-0 flex-1 auto-rows-min grid-cols-2 gap-2 overflow-y-auto pr-1 sm:grid-cols-3">
          {results.map((result) => (
            <li key={result.videoId}>
              <div className="group relative overflow-hidden rounded-lg bg-surface-800">
                <button
                  type="button"
                  onClick={() => play(result.videoId)}
                  title={`Play ${result.title} for everyone`}
                  className="block w-full cursor-pointer text-left transition-colors hover:bg-white/[0.06]"
                >
                  <div className="aspect-video w-full bg-black">
                    {result.thumbnail && (
                      <img
                        src={result.thumbnail}
                        alt=""
                        loading="lazy"
                        className="h-full w-full object-cover"
                      />
                    )}
                  </div>
                  <div className="p-2">
                    <span className="line-clamp-2 text-[11px] leading-snug text-slate-200">
                      {result.title}
                    </span>
                    <span className="mt-0.5 block truncate text-[10px] text-slate-500">
                      {result.channel}
                    </span>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => queue(result.videoId)}
                  aria-label={`Add ${result.title} to the queue`}
                  title="Add to the queue"
                  className="absolute right-1.5 top-1.5 flex cursor-pointer items-center gap-1 rounded bg-black/70 px-1.5 py-1 text-[10px] font-medium text-amber-200 opacity-0 transition-opacity hover:bg-black/90 focus-visible:opacity-100 group-hover:opacity-100"
                >
                  <PlusIcon className="h-3 w-3" />
                  {added === result.videoId ? 'Added' : 'Queue'}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * No key configured, which is a deployment's choice and not a fault. Says which
 * setting, because the person reading this is usually the person who can set it.
 */
function Unconfigured(): JSX.Element {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-white/10 p-6 text-center">
      <CompassIcon className="h-6 w-6 text-slate-700" />
      <p className="max-w-sm text-xs leading-relaxed text-slate-400">
        Searching YouTube from a browser tab needs a YouTube Data API key, and
        this deployment has not set one. Paste a link instead - everything else
        about listening together works exactly the same.
      </p>
      <p className="max-w-sm text-[11px] leading-relaxed text-slate-500">
        Set <code className="text-slate-400">VITE_YOUTUBE_API_KEY</code> and
        rebuild the web client to turn it on. The desktop app does not need it:
        it shows youtube.com itself.
      </p>
    </div>
  );
}
